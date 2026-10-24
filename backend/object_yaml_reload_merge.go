/*
 * backend/object_yaml_reload_merge.go
 *
 * Merges a local YAML draft onto the latest live object while preserving the
 * selected object's full GVK identity.
 */

package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	jsonpatch "github.com/evanphx/json-patch/v5"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
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
	// YAMLConflict is set when the merge cannot be completed automatically;
	// it carries the live YAML for manual review.
	YAMLConflict *ObjectYAMLConflict `json:"yamlConflict,omitempty"`
}

// MergeObjectYamlWithLatest reloads the live object from the target cluster and
// applies the user's local edits onto it using the same patch family kubectl
// edit uses: strategic merge for registered built-ins, JSON merge patch
// fallback otherwise.
func (g *ResourceGateway) MergeObjectYamlWithLatest(
	clusterID string,
	req ObjectYAMLReloadMergeRequest,
) (*ObjectYAMLReloadMergeResponse, error) {
	response, err := g.mergeObjectYamlWithLatest(clusterID, req)
	if conflict, ok := yamlConflictOf(err); ok {
		return &ObjectYAMLReloadMergeResponse{YAMLConflict: conflict}, nil
	}
	return response, err
}

func (g *ResourceGateway) mergeObjectYamlWithLatest(
	clusterID string,
	req ObjectYAMLReloadMergeRequest,
) (*ObjectYAMLReloadMergeResponse, error) {
	deps, _, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := g.mutationContext()
	defer cancel()

	baseObj, draftObj, currentObj, err := prepareReloadMergeContext(
		ctx,
		deps,
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
			return nil, &yamlConflictError{conflict: ObjectYAMLConflict{
				Code:                   objectYAMLMergeConflictCode,
				Message:                "Kubernetes-aware merge found conflicting live changes. Reload the latest object and re-apply the conflicting edits manually.",
				CurrentYAML:            currentYAML,
				CurrentResourceVersion: currentObj.GetResourceVersion(),
				Causes:                 []string{err.Error()},
			}}
		}
		if mergepatch.IsPreconditionFailed(err) {
			return nil, &yamlConflictError{conflict: ObjectYAMLConflict{
				Code:                   "MergePreconditionFailed",
				Message:                "Reload merge rejected changes to object identity fields. Keep apiVersion, kind, name, and namespace aligned with the selected object.",
				CurrentYAML:            currentYAML,
				CurrentResourceVersion: currentObj.GetResourceVersion(),
				Causes:                 []string{err.Error()},
			}}
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
	req ObjectYAMLReloadMergeRequest,
) (
	*unstructured.Unstructured,
	*unstructured.Unstructured,
	*unstructured.Unstructured,
	error,
) {
	ctx, err := objectMutationContext(ctx, deps)
	if err != nil {
		return nil, nil, nil, err
	}
	baseObj, draftObj, err := parseReloadMergeObjects(req)
	if err != nil {
		return nil, nil, nil, errorstatus.BadRequest(err)
	}

	gvk := schema.FromAPIVersionAndKind(req.APIVersion, req.Kind)
	gvr, isNamespaced, err := resolveObjectYAMLGVR(ctx, deps, gvk, objectYAMLResolverMutationFallback)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to resolve resource mapping for %s: %w", gvk.String(), err)
	}

	resource, err := dynamicResourceForScope(deps.DynamicClient, gvr, isNamespaced, req.Namespace)
	if err != nil {
		return nil, nil, nil, err
	}

	currentObj, err := resource.Get(ctx, req.Name, metav1.GetOptions{})
	if err != nil {
		return nil, nil, nil, wrapKubernetesError(err, "failed to fetch live object")
	}

	if err := validateReloadMergeUID(currentObj, req); err != nil {
		return nil, nil, nil, err
	}

	return baseObj, draftObj, currentObj, nil
}

func parseReloadMergeObjects(req ObjectYAMLReloadMergeRequest) (*unstructured.Unstructured, *unstructured.Unstructured, error) {
	if strings.TrimSpace(req.BaseYAML) == "" || strings.TrimSpace(req.DraftYAML) == "" {
		return nil, nil, fmt.Errorf("baseline YAML and draft YAML are required")
	}
	if strings.TrimSpace(req.Kind) == "" || strings.TrimSpace(req.APIVersion) == "" {
		return nil, nil, fmt.Errorf("apiVersion and kind are required")
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, nil, fmt.Errorf("metadata.name is required")
	}

	base, err := parseYAMLToUnstructured(strings.TrimSpace(req.BaseYAML))
	if err != nil {
		return nil, nil, err
	}
	if err := validateReloadMergeObject(base, req, "baseline YAML"); err != nil {
		return nil, nil, err
	}
	draft, err := parseYAMLToUnstructured(strings.TrimSpace(req.DraftYAML))
	if err != nil {
		return nil, nil, err
	}
	if err := validateReloadMergeObject(draft, req, "draft YAML"); err != nil {
		return nil, nil, err
	}
	return base, draft, nil
}

func validateReloadMergeUID(current *unstructured.Unstructured, req ObjectYAMLReloadMergeRequest) error {
	if req.UID == "" || string(current.GetUID()) == req.UID {
		return nil
	}
	currentYAML, err := marshalObjectYAML(current)
	if err != nil {
		return err
	}
	return &yamlConflictError{conflict: ObjectYAMLConflict{
		Code:                   "ObjectUIDMismatch",
		Message:                fmt.Sprintf("object identity changed since editing began: current uid is %s, editor tracked %s", current.GetUID(), req.UID),
		CurrentYAML:            currentYAML,
		CurrentResourceVersion: current.GetResourceVersion(),
	}}
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
	unstructured.RemoveNestedField(sanitized.Object, "metadata", "resourceVersion")
	return sanitized
}

// buildReloadMergePatch returns the draft's own edits (baseline → draft, the
// same two-way patch family Save sends) for applyReloadMergePatch to apply to
// the live object, so a field someone else changed that the draft did not edit
// keeps its live value. It fails with a mergepatch conflict when an edit
// changes a field the live object also changed since the baseline, to a
// different value.
func buildReloadMergePatch(
	gvk schema.GroupVersionKind,
	baseObj, draftObj, currentObj *unstructured.Unstructured,
) ([]byte, strategicpatch.LookupPatchMeta, error) {
	baseJSON, draftJSON, currentJSON, err := marshalMergeDocuments(baseObj, draftObj, currentObj)
	if err != nil {
		return nil, nil, err
	}

	typedObj, err := kubescheme.Scheme.New(gvk)
	if err != nil {
		patch, patchErr := buildJSONReloadMergePatch(baseJSON, draftJSON, currentJSON)
		return patch, nil, patchErr
	}
	patchMeta, err := strategicpatch.NewPatchMetaFromStruct(typedObj)
	if err != nil {
		return nil, nil, err
	}
	patch, err := buildStrategicReloadMergePatch(baseJSON, draftJSON, currentJSON, patchMeta)
	return patch, patchMeta, err
}

func buildStrategicReloadMergePatch(
	baseJSON, draftJSON, currentJSON []byte,
	patchMeta strategicpatch.LookupPatchMeta,
) ([]byte, error) {
	edits, err := strategicpatch.CreateTwoWayMergePatchUsingLookupPatchMeta(baseJSON, draftJSON, patchMeta)
	if err != nil {
		return nil, err
	}
	changed, err := strategicpatch.CreateTwoWayMergePatchUsingLookupPatchMeta(baseJSON, currentJSON, patchMeta)
	if err != nil {
		return nil, err
	}
	return edits, requireReloadMergeEditsApply(edits, changed, func(editsMap, changedMap map[string]interface{}) (bool, error) {
		dropListDirectives(editsMap)
		dropListDirectives(changedMap)
		return strategicpatch.MergingMapsHaveConflicts(editsMap, changedMap, patchMeta)
	})
}

func buildJSONReloadMergePatch(baseJSON, draftJSON, currentJSON []byte) ([]byte, error) {
	edits, err := jsonpatch.CreateMergePatch(baseJSON, draftJSON)
	if err != nil {
		return nil, err
	}
	changed, err := jsonpatch.CreateMergePatch(baseJSON, currentJSON)
	if err != nil {
		return nil, err
	}
	return edits, requireReloadMergeEditsApply(edits, changed, func(editsMap, changedMap map[string]interface{}) (bool, error) {
		return mergepatch.HasConflicts(editsMap, changedMap)
	})
}

// requireReloadMergeEditsApply fails when the draft's edits change the
// object's identity, or overlap a live change (baseline → current) with a
// different value.
func requireReloadMergeEditsApply(
	edits, changed []byte,
	hasConflicts func(editsMap, changedMap map[string]interface{}) (bool, error),
) error {
	var editsMap, changedMap map[string]interface{}
	if err := json.Unmarshal(edits, &editsMap); err != nil {
		return fmt.Errorf("failed to decode draft edits: %w", err)
	}
	if err := json.Unmarshal(changed, &changedMap); err != nil {
		return fmt.Errorf("failed to decode live changes: %w", err)
	}
	for _, precondition := range []mergepatch.PreconditionFunc{
		mergepatch.RequireKeyUnchanged("apiVersion"),
		mergepatch.RequireKeyUnchanged("kind"),
		mergepatch.RequireMetadataKeyUnchanged("name"),
		mergepatch.RequireMetadataKeyUnchanged("namespace"),
	} {
		if !precondition(editsMap) {
			return mergepatch.NewErrPreconditionFailed(editsMap)
		}
	}
	conflict, err := hasConflicts(editsMap, changedMap)
	if err != nil {
		return err
	}
	if conflict {
		return mergepatch.NewErrConflict(mergepatch.ToYAMLOrError(editsMap), mergepatch.ToYAMLOrError(changedMap))
	}
	return nil
}

// dropListDirectives removes the strategic merge patch keys that only order a
// list ($setElementOrder) or remove items from a list of scalars
// ($deleteFromPrimitiveList). Both sides carry them for any list they touched,
// merging scalar lists has no conflicts by definition, and the conflict check's
// schema lookup cannot resolve these keys.
func dropListDirectives(value interface{}) {
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, child := range typed {
			if strings.HasPrefix(key, "$setElementOrder/") || strings.HasPrefix(key, "$deleteFromPrimitiveList/") {
				delete(typed, key)
				continue
			}
			dropListDirectives(child)
		}
	case []interface{}:
		for _, child := range typed {
			dropListDirectives(child)
		}
	}
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
