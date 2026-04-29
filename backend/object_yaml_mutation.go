package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/evanphx/json-patch/v5"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/common"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/mergepatch"
	"k8s.io/apimachinery/pkg/util/strategicpatch"
	yamlutil "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/dynamic"
	kubescheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/yaml"
)

const objectYAMLErrorPrefix = "ObjectYAMLError:"
const objectYAMLFieldManager = "luxury-yacht-yaml-editor"

type objectYAMLError struct {
	Code                   string   `json:"code"`
	Message                string   `json:"message"`
	CurrentYAML            string   `json:"currentYaml,omitempty"`
	CurrentResourceVersion string   `json:"currentResourceVersion,omitempty"`
	Causes                 []string `json:"causes,omitempty"`
}

func (e *objectYAMLError) Error() string {
	payload, err := json.Marshal(e)
	if err != nil {
		return objectYAMLErrorPrefix + `{"code":"Unknown","message":"failed to encode error"}`
	}
	return objectYAMLErrorPrefix + string(payload)
}

// ObjectYAMLMutationRequest captures the payload required to validate or apply object YAML.
type ObjectYAMLMutationRequest struct {
	BaseYAML        string `json:"baseYAML"`
	YAML            string `json:"yaml"`
	Kind            string `json:"kind"`
	APIVersion      string `json:"apiVersion"`
	Namespace       string `json:"namespace"`
	Name            string `json:"name"`
	UID             string `json:"uid"`
	ResourceVersion string `json:"resourceVersion"`
}

// ObjectYAMLMutationResponse returns basic metadata after a validation/apply attempt.
type ObjectYAMLMutationResponse struct {
	ResourceVersion string `json:"resourceVersion"`
}

type mutationContext struct {
	request      ObjectYAMLMutationRequest
	base         *unstructured.Unstructured
	desired      *unstructured.Unstructured
	resource     dynamic.ResourceInterface
	current      *unstructured.Unstructured
	gvr          schema.GroupVersionResource
	isNamespaced bool
	patch        []byte
	patchType    types.PatchType
}

func (a *App) mutationContext() (context.Context, context.CancelFunc) {
	base := a.CtxOrBackground()
	if base == nil {
		base = context.Background()
	}
	if _, hasDeadline := base.Deadline(); hasDeadline {
		return base, func() {}
	}
	return context.WithTimeout(base, config.ObjectYAMLMutationRequestTimeout)
}

// ValidateObjectYaml performs a dry-run kubectl-edit-style patch to ensure the YAML is valid and safe to apply.
func (a *App) ValidateObjectYaml(clusterID string, req ObjectYAMLMutationRequest) (*ObjectYAMLMutationResponse, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := a.mutationContext()
	defer cancel()

	mc, err := prepareMutationContextWithDependencies(ctx, deps, selectionKey, req)
	if err != nil {
		return nil, err
	}

	result, err := mc.resource.Patch(
		ctx,
		req.Name,
		mc.patchType,
		mc.patch,
		metav1.PatchOptions{
			DryRun:       []string{metav1.DryRunAll},
			FieldManager: objectYAMLFieldManager,
		},
	)
	if err != nil {
		return nil, wrapKubernetesError(err, "validation failed")
	}

	return &ObjectYAMLMutationResponse{
		ResourceVersion: result.GetResourceVersion(),
	}, nil
}

// ApplyObjectYaml performs a kubectl-edit-style patch using the original editor
// baseline plus the user's edited YAML.
func (a *App) ApplyObjectYaml(clusterID string, req ObjectYAMLMutationRequest) (*ObjectYAMLMutationResponse, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := a.mutationContext()
	defer cancel()

	mc, err := prepareMutationContextWithDependencies(ctx, deps, selectionKey, req)
	if err != nil {
		return nil, err
	}

	result, err := mc.resource.Patch(
		ctx,
		req.Name,
		mc.patchType,
		mc.patch,
		metav1.PatchOptions{
			FieldManager: objectYAMLFieldManager,
		},
	)
	if err != nil {
		return nil, wrapKubernetesError(err, "apply failed")
	}

	return &ObjectYAMLMutationResponse{
		ResourceVersion: result.GetResourceVersion(),
	}, nil
}

func prepareMutationContextWithDependencies(
	ctx context.Context,
	deps common.Dependencies,
	selectionKey string,
	req ObjectYAMLMutationRequest,
) (*mutationContext, error) {
	if deps.KubernetesClient == nil || deps.DynamicClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	if ctx == nil {
		ctx = deps.Context
		if ctx == nil {
			ctx = context.Background()
		}
	}

	trimmedBaseYAML := strings.TrimSpace(req.BaseYAML)
	trimmedYAML := strings.TrimSpace(req.YAML)
	if trimmedBaseYAML == "" || trimmedYAML == "" {
		return nil, fmt.Errorf("baseline YAML and edited YAML are required")
	}

	if strings.TrimSpace(req.Kind) == "" || strings.TrimSpace(req.APIVersion) == "" {
		return nil, fmt.Errorf("apiVersion and kind are required")
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, fmt.Errorf("metadata.name is required")
	}

	base, err := parseYAMLToUnstructured(trimmedBaseYAML)
	if err != nil {
		return nil, err
	}
	desired, err := parseYAMLToUnstructured(trimmedYAML)
	if err != nil {
		return nil, err
	}

	if err := validateMutationObject(base, req, "baseline YAML"); err != nil {
		return nil, err
	}
	if err := validateMutationObject(desired, req, "edited YAML"); err != nil {
		return nil, err
	}

	gvk := schema.FromAPIVersionAndKind(req.APIVersion, req.Kind)
	gvr, isNamespaced, err := getGVRForGVKWithDependencies(ctx, deps, selectionKey, gvk)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve resource mapping for %s: %w", gvk.String(), err)
	}

	var resource dynamic.ResourceInterface
	if isNamespaced {
		namespace := desired.GetNamespace()
		if namespace == "" {
			return nil, fmt.Errorf("namespaced resources require metadata.namespace")
		}
		resource = deps.DynamicClient.Resource(gvr).Namespace(namespace)
	} else {
		resource = deps.DynamicClient.Resource(gvr)
		desired.SetNamespace("")
	}

	current, err := resource.Get(ctx, req.Name, metav1.GetOptions{})
	if err != nil {
		return nil, wrapKubernetesError(err, "failed to fetch live object")
	}

	if current.GetResourceVersion() == "" {
		return nil, fmt.Errorf("live object is missing resourceVersion; cannot safely edit")
	}

	if req.UID != "" && string(current.GetUID()) != req.UID {
		currentYAML, err := normalizeObjectYAML(current)
		if err != nil {
			return nil, err
		}
		return nil, &objectYAMLError{
			Code:                   "ObjectUIDMismatch",
			Message:                fmt.Sprintf("object identity changed since editing began: current uid is %s, editor tracked %s", current.GetUID(), req.UID),
			CurrentYAML:            currentYAML,
			CurrentResourceVersion: current.GetResourceVersion(),
		}
	}

	if isNamespaced && current.GetNamespace() != desired.GetNamespace() {
		return nil, fmt.Errorf("live object namespace %s does not match YAML namespace %s", namespaceLabel(current.GetNamespace()), namespaceLabel(desired.GetNamespace()))
	}

	patch, patchType, err := buildKubectlEditPatch(gvk, base, desired)
	if err != nil {
		return nil, err
	}

	return &mutationContext{
		request:      req,
		base:         base,
		desired:      desired,
		resource:     resource,
		current:      current,
		gvr:          gvr,
		isNamespaced: isNamespaced,
		patch:        patch,
		patchType:    patchType,
	}, nil
}

func validateMutationObject(obj *unstructured.Unstructured, req ObjectYAMLMutationRequest, label string) error {
	if obj == nil {
		return fmt.Errorf("%s is required", label)
	}
	if obj.GetKind() == "List" {
		return fmt.Errorf("list objects are not supported in YAML editor")
	}
	if !strings.EqualFold(req.Kind, obj.GetKind()) {
		return fmt.Errorf("%s kind mismatch: expected %s, found %s", label, req.Kind, obj.GetKind())
	}
	if req.APIVersion != obj.GetAPIVersion() {
		return fmt.Errorf("%s apiVersion mismatch: expected %s, found %s", label, req.APIVersion, obj.GetAPIVersion())
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

func buildKubectlEditPatch(
	gvk schema.GroupVersionKind,
	baseObj, desiredObj *unstructured.Unstructured,
) ([]byte, types.PatchType, error) {
	baseJSON, err := json.Marshal(baseObj.Object)
	if err != nil {
		return nil, "", fmt.Errorf("failed to encode baseline object: %w", err)
	}
	desiredJSON, err := json.Marshal(desiredObj.Object)
	if err != nil {
		return nil, "", fmt.Errorf("failed to encode edited object: %w", err)
	}

	preconditions := []mergepatch.PreconditionFunc{
		mergepatch.RequireKeyUnchanged("apiVersion"),
		mergepatch.RequireKeyUnchanged("kind"),
		mergepatch.RequireMetadataKeyUnchanged("name"),
		mergepatch.RequireKeyUnchanged("managedFields"),
	}

	versionedObject, err := kubescheme.Scheme.New(gvk)
	switch {
	case runtime.IsNotRegisteredError(err):
		patch, patchErr := jsonpatch.CreateMergePatch(baseJSON, desiredJSON)
		if patchErr != nil {
			return nil, "", fmt.Errorf("failed to build merge patch: %w", patchErr)
		}
		var patchMap map[string]interface{}
		if err := json.Unmarshal(patch, &patchMap); err != nil {
			return nil, "", fmt.Errorf("failed to decode merge patch: %w", err)
		}
		for _, precondition := range preconditions {
			if !precondition(patchMap) {
				return nil, "", fmt.Errorf("at least one of apiVersion, kind, name, or managedFields was changed")
			}
		}
		return patch, types.MergePatchType, nil
	case err != nil:
		return nil, "", err
	default:
		patch, patchErr := strategicpatch.CreateTwoWayMergePatch(baseJSON, desiredJSON, versionedObject, preconditions...)
		if patchErr != nil {
			if mergepatch.IsPreconditionFailed(patchErr) {
				return nil, "", fmt.Errorf("at least one of apiVersion, kind, name, or managedFields was changed")
			}
			return nil, "", fmt.Errorf("failed to build strategic merge patch: %w", patchErr)
		}
		return patch, types.StrategicMergePatchType, nil
	}
}

func parseYAMLToUnstructured(content string) (*unstructured.Unstructured, error) {
	reader := bytes.NewReader([]byte(content))
	decoder := yamlutil.NewYAMLOrJSONDecoder(reader, 4096)

	var first map[string]interface{}
	if err := decoder.Decode(&first); err != nil {
		if err == io.EOF {
			return nil, fmt.Errorf("YAML content cannot be empty")
		}
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	if isDocEmpty(first) {
		return nil, fmt.Errorf("YAML content cannot be empty")
	}

	var second map[string]interface{}
	if err := decoder.Decode(&second); err == nil {
		if !isDocEmpty(second) {
			return nil, fmt.Errorf("multiple YAML documents detected; edit one object at a time")
		}
	} else if err != io.EOF {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	jsonPayload, err := json.Marshal(first)
	if err != nil {
		return nil, fmt.Errorf("failed to convert YAML to JSON: %w", err)
	}

	obj := &unstructured.Unstructured{}
	if err := obj.UnmarshalJSON(jsonPayload); err != nil {
		return nil, fmt.Errorf("failed to decode Kubernetes object: %w", err)
	}

	return obj, nil
}

func sanitizeForUpdate(obj *unstructured.Unstructured, resourceVersion string) *unstructured.Unstructured {
	sanitized := obj.DeepCopy()
	if resourceVersion != "" {
		sanitized.SetResourceVersion(resourceVersion)
	}

	if meta, ok := sanitized.Object["metadata"].(map[string]interface{}); ok {
		delete(meta, "managedFields")
		delete(meta, "selfLink")
		delete(meta, "uid")
		delete(meta, "creationTimestamp")
		delete(meta, "deletionTimestamp")
		delete(meta, "deletionGracePeriodSeconds")
		delete(meta, "generation")
		sanitized.Object["metadata"] = meta
	}

	unstructured.RemoveNestedField(sanitized.Object, "status")

	return sanitized
}

func namespaceLabel(value string) string {
	if value == "" {
		return "<cluster-scoped>"
	}
	return value
}

func normalizeObjectYAML(obj *unstructured.Unstructured) (string, error) {
	copyObj := obj.DeepCopy()
	unstructured.RemoveNestedField(copyObj.Object, "metadata", "managedFields")
	unstructured.RemoveNestedField(copyObj.Object, "metadata", "selfLink")
	unstructured.RemoveNestedField(copyObj.Object, "metadata", "uid")
	unstructured.RemoveNestedField(copyObj.Object, "metadata", "creationTimestamp")
	unstructured.RemoveNestedField(copyObj.Object, "metadata", "deletionTimestamp")
	unstructured.RemoveNestedField(copyObj.Object, "metadata", "deletionGracePeriodSeconds")
	unstructured.RemoveNestedField(copyObj.Object, "metadata", "generation")
	unstructured.RemoveNestedField(copyObj.Object, "status")

	bytes, err := yaml.Marshal(copyObj.Object)
	if err != nil {
		return "", fmt.Errorf("failed to marshal object for diff: %w", err)
	}

	return string(bytes), nil
}
func isDocEmpty(doc map[string]interface{}) bool {
	if doc == nil {
		return true
	}
	return len(doc) == 0
}

func wrapKubernetesError(err error, defaultMessage string) error {
	var statusErr *apierrors.StatusError
	if errors.As(err, &statusErr) {
		code := string(statusErr.ErrStatus.Reason)
		if code == "" {
			code = "KubernetesError"
		}

		causes := make([]string, 0)
		if statusErr.ErrStatus.Details != nil {
			for _, cause := range statusErr.ErrStatus.Details.Causes {
				formatted := formatStatusCause(cause)
				if formatted == "" {
					continue
				}
				causes = append(causes, formatted)
			}
		}

		return &objectYAMLError{
			Code:    code,
			Message: summarizeStatusError(statusErr),
			Causes:  causes,
		}
	}

	return fmt.Errorf("%s: %w", defaultMessage, err)
}

func summarizeStatusError(statusErr *apierrors.StatusError) string {
	if statusErr == nil {
		return ""
	}

	if statusErr.ErrStatus.Reason == metav1.StatusReasonConflict &&
		statusHasCauseType(statusErr.ErrStatus.Details, metav1.CauseTypeFieldManagerConflict) {
		return "Server-side apply found field ownership conflicts. Reload the latest object or remove the conflicting field edits listed below."
	}

	if statusErr.ErrStatus.Message != "" {
		return statusErr.ErrStatus.Message
	}

	return statusErr.Error()
}

func statusHasCauseType(details *metav1.StatusDetails, expected metav1.CauseType) bool {
	if details == nil {
		return false
	}
	for _, cause := range details.Causes {
		if cause.Type == expected {
			return true
		}
	}
	return false
}

func formatStatusCause(cause metav1.StatusCause) string {
	if cause.Message == "" && cause.Field == "" {
		return ""
	}

	if cause.Type == metav1.CauseTypeFieldManagerConflict {
		switch {
		case cause.Field != "" && cause.Message != "":
			return fmt.Sprintf("%s: %s", cause.Field, cause.Message)
		case cause.Field != "":
			return fmt.Sprintf("%s: owned by another field manager", cause.Field)
		default:
			return cause.Message
		}
	}

	builder := strings.Builder{}
	if cause.Field != "" {
		builder.WriteString(cause.Field)
		builder.WriteString(": ")
	}
	if cause.Message != "" {
		builder.WriteString(cause.Message)
	}
	if cause.Type != "" {
		builder.WriteString(fmt.Sprintf(" (%s)", cause.Type))
	}
	return builder.String()
}

func (a *App) getGVRForGVK(ctx context.Context, clusterID string, gvk schema.GroupVersionKind) (schema.GroupVersionResource, bool, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return schema.GroupVersionResource{}, false, err
	}
	return getGVRForGVKWithDependencies(ctx, deps, selectionKey, gvk)
}

// getGVRForGVKWithDependencies is the YAML mutation path's GVK resolver.
// As of step 7 of the kind-only-objects fix it delegates the strict
// group/version/kind walk to the shared common.ResolveGVRForGVK helper —
// the canonical resolver that lives in backend/resources/common so both
// the backend and generic packages can call it without a package cycle.
//
// This wrapper still exists (rather than the mutation path calling
// common.ResolveGVRForGVK directly) because it adds one mutation-specific
// behaviour: a kind-only fallback through common.DiscoverGVRByKind for
// the rare case where strict discovery fails (partial API server
// responses, stale caches). The fallback's result is validated against
// the requested GVK before being returned, so it can never silently
// target a wrong-group CRD — if discovery yields a different group
// than what the caller asked for, the mismatch surfaces as an error.
//
// The selectionKey parameter used to drive a legacy response-cache
// lookup that has since been retired; it is kept in the signature for
// source-compatibility with existing callers.
func getGVRForGVKWithDependencies(
	ctx context.Context,
	deps common.Dependencies,
	_ string,
	gvk schema.GroupVersionKind,
) (schema.GroupVersionResource, bool, error) {
	gvr, namespaced, err := common.ResolveGVRForGVK(ctx, deps, gvk)
	if err == nil {
		return gvr, namespaced, nil
	}

	// Strict resolver could not find the GVK. Try the canonical kind-only
	// discovery walk as a partial-discovery safety net, then validate the
	// result against the requested group/version so we never accept a
	// wrong-group hit. If validation fails, return the original strict
	// error so the caller sees an actionable failure rather than a
	// misleading kind-only success.
	//
	// Group/version comparison is case-sensitive (==) to match the strict
	// resolver in common.ResolveGVRForGVK — Kubernetes API group and
	// version names are RFC 1123 DNS labels, never case-insensitive. This
	// guard's whole purpose is to prevent silent wrong-group hits, so it
	// must be at least as strict as the primary resolver.
	if fallbackGVR, fallbackNamespaced, fallbackErr := common.DiscoverGVRByKind(ctx, deps, gvk.Kind); fallbackErr == nil {
		if (gvk.Group == "" || fallbackGVR.Group == gvk.Group) &&
			(gvk.Version == "" || fallbackGVR.Version == gvk.Version) {
			return fallbackGVR, fallbackNamespaced, nil
		}
	}

	return schema.GroupVersionResource{}, false, err
}
