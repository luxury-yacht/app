package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/evanphx/json-patch/v5"
	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	jsonmergepatch "k8s.io/apimachinery/pkg/util/jsonmergepatch"
	"k8s.io/apimachinery/pkg/util/mergepatch"
	"k8s.io/apimachinery/pkg/util/strategicpatch"
	yamlutil "k8s.io/apimachinery/pkg/util/yaml"
	kubescheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/yaml"
)

const objectYAMLMergeConflictCode = "MergeConflict"

// ObjectYAMLReloadMergeRequest captures the baseline editor state and the
// current local draft so the backend can merge them with the latest live
// object using kubectl-like patch semantics.
type ObjectYAMLReloadMergeRequest struct {
	BaseYAML   string `json:"baseYAML"`
	DraftYAML  string `json:"draftYAML"`
	Kind       string `json:"kind"`
	APIVersion string `json:"apiVersion"`
	Namespace  string `json:"namespace"`
	Name       string `json:"name"`
	UID        string `json:"uid"`
}

// ObjectYAMLReloadMergeResponse returns both the merged draft and the latest
// live YAML the merge was based on.
type ObjectYAMLReloadMergeResponse struct {
	MergedYAML      string `json:"mergedYAML"`
	CurrentYAML     string `json:"currentYAML"`
	ResourceVersion string `json:"resourceVersion"`
}

// MergeObjectYamlWithLatest reloads the live object from the target cluster and
// applies the user's local edits onto it using the same patch family kubectl
// edit uses: strategic merge for registered built-ins, JSON merge patch
// fallback otherwise.
func (a *App) MergeObjectYamlWithLatest(
	clusterID string,
	req ObjectYAMLReloadMergeRequest,
) (*ObjectYAMLReloadMergeResponse, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := a.mutationContext()
	defer cancel()

	baseObj, draftObj, currentObj, err := prepareReloadMergeContext(
		ctx,
		deps,
		selectionKey,
		req,
	)
	if err != nil {
		return nil, err
	}

	currentYAML, err := marshalObjectYAML(currentObj)
	if err != nil {
		return nil, err
	}

	gvk := schema.FromAPIVersionAndKind(req.APIVersion, req.Kind)
	patch, patchMeta, err := buildReloadMergePatch(gvk, baseObj, draftObj, currentObj)
	if err != nil {
		if mergepatch.IsConflict(err) {
			return nil, &objectYAMLError{
				Code:                   objectYAMLMergeConflictCode,
				Message:                "Kubernetes-aware merge found conflicting live changes. Reload the latest object and re-apply the conflicting edits manually.",
				CurrentYAML:            currentYAML,
				CurrentResourceVersion: currentObj.GetResourceVersion(),
				Causes:                 []string{err.Error()},
			}
		}
		if mergepatch.IsPreconditionFailed(err) {
			return nil, &objectYAMLError{
				Code:                   "MergePreconditionFailed",
				Message:                "Reload merge rejected changes to object identity fields. Keep apiVersion, kind, name, and namespace aligned with the selected object.",
				CurrentYAML:            currentYAML,
				CurrentResourceVersion: currentObj.GetResourceVersion(),
				Causes:                 []string{err.Error()},
			}
		}
		return nil, fmt.Errorf("failed to build reload merge patch: %w", err)
	}

	mergedObj, err := applyReloadMergePatch(currentObj, patch, patchMeta)
	if err != nil {
		return nil, fmt.Errorf("failed to apply reload merge patch: %w", err)
	}

	// Keep the live resourceVersion authoritative even if the local draft had
	// removed or edited it.
	if currentObj.GetResourceVersion() != "" {
		mergedObj.SetResourceVersion(currentObj.GetResourceVersion())
	}

	mergedYAML, err := marshalObjectYAML(mergedObj)
	if err != nil {
		return nil, err
	}

	return &ObjectYAMLReloadMergeResponse{
		MergedYAML:      mergedYAML,
		CurrentYAML:     currentYAML,
		ResourceVersion: currentObj.GetResourceVersion(),
	}, nil
}

func prepareReloadMergeContext(
	ctx context.Context,
	deps common.Dependencies,
	selectionKey string,
	req ObjectYAMLReloadMergeRequest,
) (
	*unstructured.Unstructured,
	*unstructured.Unstructured,
	*unstructured.Unstructured,
	error,
) {
	if deps.KubernetesClient == nil || deps.DynamicClient == nil {
		return nil, nil, nil, fmt.Errorf("kubernetes client not initialized")
	}
	if ctx == nil {
		ctx = deps.Context
		if ctx == nil {
			ctx = context.Background()
		}
	}

	if strings.TrimSpace(req.BaseYAML) == "" || strings.TrimSpace(req.DraftYAML) == "" {
		return nil, nil, nil, fmt.Errorf("baseline YAML and draft YAML are required")
	}
	if strings.TrimSpace(req.Kind) == "" || strings.TrimSpace(req.APIVersion) == "" {
		return nil, nil, nil, fmt.Errorf("apiVersion and kind are required")
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, nil, nil, fmt.Errorf("metadata.name is required")
	}

	baseObj, err := parseYAMLToUnstructured(strings.TrimSpace(req.BaseYAML))
	if err != nil {
		return nil, nil, nil, err
	}
	if err := validateReloadMergeObject(baseObj, req, "baseline YAML"); err != nil {
		return nil, nil, nil, err
	}

	draftObj, err := parseYAMLToUnstructured(strings.TrimSpace(req.DraftYAML))
	if err != nil {
		return nil, nil, nil, err
	}
	if err := validateReloadMergeObject(draftObj, req, "draft YAML"); err != nil {
		return nil, nil, nil, err
	}

	gvk := schema.FromAPIVersionAndKind(req.APIVersion, req.Kind)
	gvr, isNamespaced, err := getGVRForGVKWithDependencies(ctx, deps, selectionKey, gvk)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to resolve resource mapping for %s: %w", gvk.String(), err)
	}

	var resource interface {
		Get(context.Context, string, metav1.GetOptions, ...string) (*unstructured.Unstructured, error)
	}
	if isNamespaced {
		if strings.TrimSpace(req.Namespace) == "" {
			return nil, nil, nil, fmt.Errorf("namespaced resources require metadata.namespace")
		}
		resource = deps.DynamicClient.Resource(gvr).Namespace(req.Namespace)
	} else {
		resource = deps.DynamicClient.Resource(gvr)
	}

	currentObj, err := resource.Get(ctx, req.Name, metav1.GetOptions{})
	if err != nil {
		return nil, nil, nil, wrapKubernetesError(err, "failed to fetch live object")
	}

	if req.UID != "" && string(currentObj.GetUID()) != req.UID {
		currentYAML, yamlErr := marshalObjectYAML(currentObj)
		if yamlErr != nil {
			return nil, nil, nil, yamlErr
		}
		return nil, nil, nil, &objectYAMLError{
			Code:                   "ObjectUIDMismatch",
			Message:                fmt.Sprintf("object identity changed since editing began: current uid is %s, editor tracked %s", currentObj.GetUID(), req.UID),
			CurrentYAML:            currentYAML,
			CurrentResourceVersion: currentObj.GetResourceVersion(),
		}
	}

	return baseObj, draftObj, currentObj, nil
}

func validateReloadMergeObject(
	obj *unstructured.Unstructured,
	req ObjectYAMLReloadMergeRequest,
	label string,
) error {
	if obj == nil {
		return fmt.Errorf("%s is required", label)
	}
	if obj.GetKind() == "List" {
		return fmt.Errorf("list objects are not supported in YAML editor")
	}
	if req.APIVersion != obj.GetAPIVersion() {
		return fmt.Errorf("%s apiVersion mismatch: expected %s, found %s", label, req.APIVersion, obj.GetAPIVersion())
	}
	if !strings.EqualFold(req.Kind, obj.GetKind()) {
		return fmt.Errorf("%s kind mismatch: expected %s, found %s", label, req.Kind, obj.GetKind())
	}
	if req.Name != obj.GetName() {
		return fmt.Errorf("%s metadata.name mismatch: expected %s, found %s", label, req.Name, obj.GetName())
	}
	if req.Namespace != obj.GetNamespace() {
		return fmt.Errorf(
			"%s metadata.namespace mismatch: expected %s, found %s",
			label,
			namespaceLabel(req.Namespace),
			namespaceLabel(obj.GetNamespace()),
		)
	}
	if req.UID != "" && string(obj.GetUID()) != "" && string(obj.GetUID()) != req.UID {
		return fmt.Errorf("%s metadata.uid mismatch: expected %s, found %s", label, req.UID, obj.GetUID())
	}
	return nil
}

func sanitizeForMerge(obj *unstructured.Unstructured) *unstructured.Unstructured {
	sanitized := sanitizeForUpdate(obj, "")
	unstructured.RemoveNestedField(sanitized.Object, "metadata", "uid")
	unstructured.RemoveNestedField(sanitized.Object, "metadata", "creationTimestamp")
	unstructured.RemoveNestedField(sanitized.Object, "metadata", "deletionTimestamp")
	unstructured.RemoveNestedField(sanitized.Object, "metadata", "deletionGracePeriodSeconds")
	unstructured.RemoveNestedField(sanitized.Object, "metadata", "generation")
	unstructured.RemoveNestedField(sanitized.Object, "metadata", "resourceVersion")
	return sanitized
}

func buildReloadMergePatch(
	gvk schema.GroupVersionKind,
	baseObj, draftObj, currentObj *unstructured.Unstructured,
) ([]byte, strategicpatch.LookupPatchMeta, error) {
	baseJSON, draftJSON, currentJSON, err := marshalMergeDocuments(baseObj, draftObj, currentObj)
	if err != nil {
		return nil, nil, err
	}

	preconditions := []mergepatch.PreconditionFunc{
		mergepatch.RequireKeyUnchanged("apiVersion"),
		mergepatch.RequireKeyUnchanged("kind"),
		mergepatch.RequireMetadataKeyUnchanged("name"),
		mergepatch.RequireMetadataKeyUnchanged("namespace"),
	}

	typedObj, err := kubescheme.Scheme.New(gvk)
	if err == nil {
		patchMeta, patchMetaErr := strategicpatch.NewPatchMetaFromStruct(typedObj)
		if patchMetaErr != nil {
			return nil, nil, patchMetaErr
		}
		patch, patchErr := strategicpatch.CreateThreeWayMergePatch(
			baseJSON,
			draftJSON,
			currentJSON,
			patchMeta,
			false,
			preconditions...,
		)
		return patch, patchMeta, patchErr
	}

	patch, patchErr := jsonmergepatch.CreateThreeWayJSONMergePatch(
		baseJSON,
		draftJSON,
		currentJSON,
		preconditions...,
	)
	return patch, nil, patchErr
}

func marshalMergeDocuments(
	baseObj, draftObj, currentObj *unstructured.Unstructured,
) ([]byte, []byte, []byte, error) {
	baseJSON, err := json.Marshal(sanitizeForMerge(baseObj).Object)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to encode baseline object: %w", err)
	}
	draftJSON, err := json.Marshal(sanitizeForMerge(draftObj).Object)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to encode draft object: %w", err)
	}
	currentJSON, err := json.Marshal(sanitizeForMerge(currentObj).Object)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to encode live object: %w", err)
	}
	return baseJSON, draftJSON, currentJSON, nil
}

func applyReloadMergePatch(
	currentObj *unstructured.Unstructured,
	patch []byte,
	patchMeta strategicpatch.LookupPatchMeta,
) (*unstructured.Unstructured, error) {
	currentJSON, err := json.Marshal(currentObj.Object)
	if err != nil {
		return nil, fmt.Errorf("failed to encode current object: %w", err)
	}

	var mergedJSON []byte
	if patchMeta != nil {
		mergedJSON, err = strategicpatch.StrategicMergePatchUsingLookupPatchMeta(currentJSON, patch, patchMeta)
	} else {
		mergedJSON, err = jsonpatch.MergePatch(currentJSON, patch)
	}
	if err != nil {
		return nil, err
	}

	mergedObj := &unstructured.Unstructured{}
	if err := mergedObj.UnmarshalJSON(mergedJSON); err != nil {
		return nil, fmt.Errorf("failed to decode merged object: %w", err)
	}
	return mergedObj, nil
}

func marshalObjectYAML(obj *unstructured.Unstructured) (string, error) {
	if obj == nil {
		return "", fmt.Errorf("object payload is required")
	}

	yamlBytes, err := yaml.Marshal(obj.Object)
	if err != nil {
		return "", fmt.Errorf("failed to marshal object YAML: %w", err)
	}

	normalized, err := yamlutil.ToJSON(yamlBytes)
	if err != nil {
		return string(yamlBytes), nil
	}

	normalizedYAML, err := yaml.JSONToYAML(normalized)
	if err != nil {
		return string(yamlBytes), nil
	}
	return string(normalizedYAML), nil
}
