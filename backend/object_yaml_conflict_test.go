package backend

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/validation/field"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

// replaceLiveDeploymentUID simulates the edited object being deleted and
// recreated under the same name while the editor was open.
func replaceLiveDeploymentUID(t *testing.T, dynamicClient *dynamicfake.FakeDynamicClient) {
	t.Helper()
	gvr := appsv1.SchemeGroupVersion.WithResource("deployments")
	live, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "demo", metav1.GetOptions{})
	require.NoError(t, err)
	live.SetUID(types.UID("replacement-uid"))
	live.SetResourceVersion("99")
	require.NoError(t, dynamicClient.Tracker().Update(gvr, live, "default"))
}

func uidTrackedYAMLRequest() ObjectYAMLMutationRequest {
	return ObjectYAMLMutationRequest{
		BaseYAML:   deploymentYAML("42", "nginx:1.25"),
		YAML:       deploymentYAML("42", "nginx:1.26"),
		Kind:       "Deployment",
		APIVersion: "apps/v1",
		Namespace:  "default",
		Name:       "demo",
		UID:        "demo-uid",
	}
}

// A YAML conflict is an outcome the user resolves in the editor, not a failure:
// it comes back as a result carrying the live YAML, and never as an error whose
// text could carry that YAML into toasts, history or telemetry.
func TestYAMLConflictsAreResults(t *testing.T) {
	t.Run("apply after the object was replaced", func(t *testing.T) {
		app, dynamicClient, clusterID := setupYAMLTestApp(t)
		replaceLiveDeploymentUID(t, dynamicClient)

		response, err := app.ApplyObjectYaml(clusterID, uidTrackedYAMLRequest())

		require.NoError(t, err)
		require.NotNil(t, response.YAMLConflict)
		require.Equal(t, "ObjectUIDMismatch", response.YAMLConflict.Code)
		require.Equal(t, "99", response.YAMLConflict.CurrentResourceVersion)
		require.Contains(t, response.YAMLConflict.CurrentYAML, "kind: Deployment")
	})

	t.Run("ownership check after the object was replaced", func(t *testing.T) {
		app, dynamicClient, clusterID := setupYAMLTestApp(t)
		replaceLiveDeploymentUID(t, dynamicClient)

		response, err := app.CheckObjectYamlOwnership(clusterID, uidTrackedYAMLRequest())

		require.NoError(t, err)
		require.NotNil(t, response.YAMLConflict)
		require.Equal(t, "ObjectUIDMismatch", response.YAMLConflict.Code)
		require.Empty(t, response.Conflicts)
	})

	t.Run("reload merge after the object was replaced", func(t *testing.T) {
		app, dynamicClient, clusterID := setupYAMLTestApp(t)
		replaceLiveDeploymentUID(t, dynamicClient)

		response, err := app.MergeObjectYamlWithLatest(clusterID, ObjectYAMLReloadMergeRequest{
			BaseYAML: deploymentYAML("42", "nginx:1.25"), DraftYAML: deploymentYAML("42", "nginx:1.26"),
			Kind: "Deployment", APIVersion: "apps/v1", Namespace: "default", Name: "demo", UID: "demo-uid",
		})

		require.NoError(t, err)
		require.NotNil(t, response.YAMLConflict)
		require.Equal(t, "ObjectUIDMismatch", response.YAMLConflict.Code)
		require.True(t, strings.Contains(response.YAMLConflict.Message, "current uid is replacement-uid"))
	})
}

// An API rejection of the apply stays the Kubernetes error, so the status
// carries its reason and field causes, and its message holds no YAML.
func TestYAMLApplyRejectionKeepsKubernetesStatus(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)
	invalid := apierrors.NewInvalid(
		schema.GroupKind{Group: "apps", Kind: "Deployment"},
		"demo",
		field.ErrorList{field.Required(field.NewPath("spec", "replicas"), "field required")},
	)
	dynamicClient.Fake.PrependReactor("patch", "*", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, invalid
	})

	_, err := app.ApplyObjectYaml(clusterID, uidTrackedYAMLRequest())

	var statusErr *apierrors.StatusError
	require.True(t, errors.As(err, &statusErr), "the Kubernetes error stays in the chain")
	status := errorstatus.Classify(err)
	require.Equal(t, errorstatus.ReasonInvalid, status.Reason)
	require.NotNil(t, status.Details)
	require.Len(t, status.Details.Causes, 1)
	require.Contains(t, status.Details.Causes[0], "spec.replicas")
	require.NotContains(t, err.Error(), "kind: Deployment")
}
