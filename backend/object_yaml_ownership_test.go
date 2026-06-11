package backend

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	cgotesting "k8s.io/client-go/testing"
)

func ownershipEditedYAML() string {
	return strings.Replace(baseYAML(), "replicas: 2", "replicas: 5", 1)
}

func ownershipRequest(yaml string) ObjectYAMLMutationRequest {
	return ObjectYAMLMutationRequest{
		BaseYAML:        baseYAML(),
		YAML:            yaml,
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		UID:             "demo-uid",
		ResourceVersion: "42",
	}
}

func TestCheckObjectYamlOwnershipReportsControllerConflictsAndFiltersBenignManagers(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)

	sawApply := false
	dynamicClient.Fake.PrependReactor("patch", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		patchAction := action.(cgotesting.PatchActionImpl)
		if patchAction.GetPatchType() != types.ApplyPatchType {
			return false, nil, nil
		}
		sawApply = true

		opts := patchAction.GetPatchOptions()
		if len(opts.DryRun) != 1 || opts.DryRun[0] != metav1.DryRunAll {
			t.Errorf("expected dry-run apply, got %#v", opts.DryRun)
		}
		if opts.Force == nil || *opts.Force {
			t.Errorf("expected force=false apply, got %#v", opts.Force)
		}
		if opts.FieldManager != objectYAMLFieldManager {
			t.Errorf("expected field manager %q, got %q", objectYAMLFieldManager, opts.FieldManager)
		}

		var intent map[string]interface{}
		if err := json.Unmarshal(patchAction.GetPatch(), &intent); err != nil {
			t.Errorf("failed to decode apply intent: %v", err)
		}
		if _, exists := intent["status"]; exists {
			t.Error("apply intent must not carry status")
		}
		if metadata, ok := intent["metadata"].(map[string]interface{}); ok {
			if _, exists := metadata["resourceVersion"]; exists {
				t.Error("apply intent must not carry resourceVersion")
			}
			if _, exists := metadata["managedFields"]; exists {
				t.Error("apply intent must not carry managedFields")
			}
		}

		return true, nil, apierrors.NewApplyConflict([]metav1.StatusCause{
			{
				Type:    metav1.CauseTypeFieldManagerConflict,
				Message: `conflict with "flux" using apps/v1`,
				Field:   ".spec.replicas",
			},
			{
				Type:    metav1.CauseTypeFieldManagerConflict,
				Message: `conflict with "kubectl-client-side-apply" using apps/v1`,
				Field:   ".spec.template.spec.containers[name=\"app\"].image",
			},
			{
				Type:    metav1.CauseTypeFieldManagerConflict,
				Message: `conflict with "luxury-yacht-yaml-editor" using apps/v1`,
				Field:   ".metadata.labels.app",
			},
		}, "Apply failed with 3 conflicts")
	})

	response, err := app.CheckObjectYamlOwnership(clusterID, ownershipRequest(ownershipEditedYAML()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !sawApply {
		t.Fatal("expected a server-side apply dry run against the cluster")
	}
	if len(response.Conflicts) != 1 {
		t.Fatalf("expected exactly the controller conflict after filtering, got %#v", response.Conflicts)
	}
	conflict := response.Conflicts[0]
	if conflict.Manager != "flux" {
		t.Errorf("expected manager flux, got %q", conflict.Manager)
	}
	if conflict.Field != ".spec.replicas" {
		t.Errorf("expected field .spec.replicas, got %q", conflict.Field)
	}
	if conflict.Message == "" {
		t.Error("expected conflict message to be populated")
	}
}

func TestCheckObjectYamlOwnershipReturnsNoConflictsWhenApplySucceeds(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)

	dynamicClient.Fake.PrependReactor("patch", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		patchAction := action.(cgotesting.PatchActionImpl)
		if patchAction.GetPatchType() != types.ApplyPatchType {
			return false, nil, nil
		}
		current, err := dynamicClient.Tracker().Get(
			patchAction.GetResource(),
			patchAction.GetNamespace(),
			patchAction.GetName(),
		)
		if err != nil {
			return true, nil, err
		}
		return true, current, nil
	})

	response, err := app.CheckObjectYamlOwnership(clusterID, ownershipRequest(ownershipEditedYAML()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if response == nil || response.Conflicts == nil {
		t.Fatal("expected a non-nil conflicts slice")
	}
	if len(response.Conflicts) != 0 {
		t.Fatalf("expected no conflicts, got %#v", response.Conflicts)
	}
}

func TestCheckObjectYamlOwnershipSkipsServerCheckWhenNothingChanged(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)

	sawApply := false
	dynamicClient.Fake.PrependReactor("patch", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		patchAction := action.(cgotesting.PatchActionImpl)
		if patchAction.GetPatchType() != types.ApplyPatchType {
			return false, nil, nil
		}
		sawApply = true
		return true, nil, errors.New("should not be called")
	})

	response, err := app.CheckObjectYamlOwnership(clusterID, ownershipRequest(baseYAML()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sawApply {
		t.Fatal("expected no server call for an unchanged document")
	}
	if len(response.Conflicts) != 0 {
		t.Fatalf("expected no conflicts, got %#v", response.Conflicts)
	}
}

func TestCheckObjectYamlOwnershipBubblesUnexpectedErrors(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)

	dynamicClient.Fake.PrependReactor("patch", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		patchAction := action.(cgotesting.PatchActionImpl)
		if patchAction.GetPatchType() != types.ApplyPatchType {
			return false, nil, nil
		}
		return true, nil, errors.New("server exploded")
	})

	_, err := app.CheckObjectYamlOwnership(clusterID, ownershipRequest(ownershipEditedYAML()))
	if err == nil {
		t.Fatal("expected unexpected server errors to bubble to the caller")
	}
}
