/*
 * backend/object_yaml_mutation.go
 *
 * Validates and applies object YAML edits through the shared YAML GVK
 * resolution policy and Kubernetes patch semantics.
 */

package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	jsonpatch "github.com/evanphx/json-patch/v5"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/objectyaml"
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

const objectYAMLFieldManager = "luxury-yacht-yaml-editor"

// ObjectYAMLConflict is a YAML-editor outcome the user resolves in the editor:
// the edited object changed or was replaced since editing began. It carries the
// live YAML, so it is returned as a result and never as error text.
type ObjectYAMLConflict struct {
	Code                   string   `json:"code"`
	Message                string   `json:"message"`
	Causes                 []string `json:"causes,omitempty"`
	CurrentYAML            string   `json:"currentYaml,omitempty"`
	CurrentResourceVersion string   `json:"currentResourceVersion,omitempty"`
}

// yamlConflictError carries a conflict out of the shared preparation path;
// the YAML bindings turn it into a result.
type yamlConflictError struct {
	conflict ObjectYAMLConflict
}

func (e *yamlConflictError) Error() string { return e.conflict.Message }

// yamlConflictOf returns the conflict carried by err, if any.
func yamlConflictOf(err error) (*ObjectYAMLConflict, bool) {
	var conflictErr *yamlConflictError
	if !errors.As(err, &conflictErr) {
		return nil, false
	}
	conflict := conflictErr.conflict
	return &conflict, true
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

// ObjectYAMLMutationResponse returns basic metadata after a validation/apply
// attempt, or the conflict that stopped it.
type ObjectYAMLMutationResponse struct {
	ResourceVersion string              `json:"resourceVersion"`
	YAMLConflict    *ObjectYAMLConflict `json:"yamlConflict,omitempty"`
}

type mutationContext struct {
	desired   *unstructured.Unstructured
	resource  dynamic.ResourceInterface
	patch     []byte
	patchType types.PatchType
}

func (g *ResourceGateway) mutationContext() (context.Context, context.CancelFunc) {
	return common.WithDefaultTimeout(g.CtxOrBackground(), config.ObjectYAMLMutationRequestTimeout)
}

// ApplyObjectYaml performs a kubectl-edit-style patch using the original editor
// baseline plus the user's edited YAML.
func (g *ResourceGateway) ApplyObjectYaml(clusterID string, req ObjectYAMLMutationRequest) (*ObjectYAMLMutationResponse, error) {
	response, err := g.applyObjectYaml(clusterID, req)
	if conflict, ok := yamlConflictOf(err); ok {
		return &ObjectYAMLMutationResponse{YAMLConflict: conflict}, nil
	}
	return response, errorstatus.UserAction(objectYAMLStatusRef(clusterID, req), err)
}

// objectYAMLStatusRef is the edited object as an error-status object reference.
func objectYAMLStatusRef(clusterID string, req ObjectYAMLMutationRequest) errorstatus.ObjectRef {
	gvk := schema.FromAPIVersionAndKind(req.APIVersion, req.Kind)
	return errorstatus.ObjectRef{
		ClusterID: clusterID, Group: gvk.Group, Version: gvk.Version,
		Kind: gvk.Kind, Namespace: req.Namespace, Name: req.Name,
	}
}

func (g *ResourceGateway) applyObjectYaml(clusterID string, req ObjectYAMLMutationRequest) (*ObjectYAMLMutationResponse, error) {
	deps, selectionKey, err := g.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := g.mutationContext()
	defer cancel()

	mc, err := g.prepareAuthorizedYAMLMutation(ctx, deps, req)
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

	g.invalidateResponseCacheForGVK(selectionKey, schema.FromAPIVersionAndKind(req.APIVersion, req.Kind), req.Namespace, req.Name)

	return &ObjectYAMLMutationResponse{
		ResourceVersion: result.GetResourceVersion(),
	}, nil
}

func (g *ResourceGateway) prepareAuthorizedYAMLMutation(
	ctx context.Context,
	deps common.Dependencies,
	req ObjectYAMLMutationRequest,
) (*mutationContext, error) {
	ctx, err := objectMutationContext(ctx, deps)
	if err != nil {
		return nil, err
	}
	base, desired, err := parseMutationObjects(req)
	if err != nil {
		return nil, errorstatus.BadRequest(err)
	}

	gvk := schema.FromAPIVersionAndKind(req.APIVersion, req.Kind)
	gvr, isNamespaced, err := resolveObjectYAMLGVR(ctx, deps, gvk, objectYAMLResolverMutationFallback)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve resource mapping for %s: %w", gvk.String(), err)
	}
	resource, err := mutationResourceForObject(deps.DynamicClient, gvr, isNamespaced, desired)
	if err != nil {
		return nil, err
	}
	current, err := resource.Get(ctx, req.Name, metav1.GetOptions{})
	if err != nil {
		return nil, wrapKubernetesError(err, "failed to fetch live object")
	}
	if err := validateCurrentMutationObject(current, desired, req, isNamespaced); err != nil {
		return nil, err
	}

	if err := objectyaml.EnforceFieldPolicy(base, desired); err != nil {
		return nil, err
	}
	objectyaml.PreserveFields(base, desired, current)
	patch, patchType, err := buildKubectlEditPatch(gvk, base, desired)
	if err != nil {
		return nil, err
	}

	if err := requireResolvedResourcePermission(ctx, deps, gvr, isNamespaced, resourcePermissionCheck{
		Kind: req.Kind, Namespace: req.Namespace, Name: req.Name, Verb: "patch",
	}); err != nil {
		return nil, err
	}
	return &mutationContext{
		desired: desired, resource: resource, patch: patch, patchType: patchType,
	}, nil
}

func objectMutationContext(ctx context.Context, deps common.Dependencies) (context.Context, error) {
	if deps.KubernetesClient == nil || deps.DynamicClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	if ctx != nil {
		return ctx, nil
	}
	return nil, fmt.Errorf("operation context is required")
}

func parseMutationObjects(req ObjectYAMLMutationRequest) (*unstructured.Unstructured, *unstructured.Unstructured, error) {
	trimmedBaseYAML := strings.TrimSpace(req.BaseYAML)
	trimmedYAML := strings.TrimSpace(req.YAML)
	if trimmedBaseYAML == "" || trimmedYAML == "" {
		return nil, nil, fmt.Errorf("baseline YAML and edited YAML are required")
	}
	if strings.TrimSpace(req.Kind) == "" || strings.TrimSpace(req.APIVersion) == "" {
		return nil, nil, fmt.Errorf("apiVersion and kind are required")
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, nil, fmt.Errorf("metadata.name is required")
	}

	base, err := parseYAMLToUnstructured(trimmedBaseYAML)
	if err != nil {
		return nil, nil, err
	}
	desired, err := parseYAMLToUnstructured(trimmedYAML)
	if err != nil {
		return nil, nil, err
	}
	if err := validateMutationObject(base, req, "baseline YAML"); err != nil {
		return nil, nil, err
	}
	if err := validateMutationObject(desired, req, "edited YAML"); err != nil {
		return nil, nil, err
	}
	return base, desired, nil
}

func dynamicResourceForScope(client dynamic.Interface, gvr schema.GroupVersionResource, namespaced bool, namespace string) (dynamic.ResourceInterface, error) {
	if namespaced {
		if strings.TrimSpace(namespace) == "" {
			return nil, fmt.Errorf("namespaced resources require metadata.namespace")
		}
		return client.Resource(gvr).Namespace(namespace), nil
	}
	return client.Resource(gvr), nil
}

func mutationResourceForObject(
	client dynamic.Interface,
	gvr schema.GroupVersionResource,
	namespaced bool,
	desired *unstructured.Unstructured,
) (dynamic.ResourceInterface, error) {
	resource, err := dynamicResourceForScope(client, gvr, namespaced, desired.GetNamespace())
	if err != nil {
		return nil, err
	}
	if !namespaced {
		desired.SetNamespace("")
	}
	return resource, nil
}

func validateCurrentMutationObject(
	current, desired *unstructured.Unstructured,
	req ObjectYAMLMutationRequest,
	isNamespaced bool,
) error {
	if current.GetResourceVersion() == "" {
		return fmt.Errorf("live object is missing resourceVersion; cannot safely edit")
	}
	if req.UID != "" && string(current.GetUID()) != req.UID {
		currentYAML, err := normalizeObjectYAML(current)
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
	if isNamespaced && current.GetNamespace() != desired.GetNamespace() {
		return fmt.Errorf("live object namespace %s does not match YAML namespace %s", namespaceLabel(current.GetNamespace()), namespaceLabel(desired.GetNamespace()))
	}
	return nil
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
		mergepatch.RequireMetadataKeyUnchanged("managedFields"),
	}

	versionedObject, err := kubescheme.Scheme.New(gvk)
	switch {
	case runtime.IsNotRegisteredError(err):
		return buildJSONMergePatch(baseJSON, desiredJSON, preconditions)
	case err != nil:
		return nil, "", err
	default:
		return buildStrategicMergePatch(baseJSON, desiredJSON, versionedObject, preconditions)
	}
}

func buildJSONMergePatch(baseJSON, desiredJSON []byte, preconditions []mergepatch.PreconditionFunc) ([]byte, types.PatchType, error) {
	patch, err := jsonpatch.CreateMergePatch(baseJSON, desiredJSON)
	if err != nil {
		return nil, "", fmt.Errorf("failed to build merge patch: %w", err)
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
}

func buildStrategicMergePatch(baseJSON, desiredJSON []byte, versionedObject runtime.Object, preconditions []mergepatch.PreconditionFunc) ([]byte, types.PatchType, error) {
	patch, err := strategicpatch.CreateTwoWayMergePatch(baseJSON, desiredJSON, versionedObject, preconditions...)
	if err == nil {
		return patch, types.StrategicMergePatchType, nil
	}
	if mergepatch.IsPreconditionFailed(err) {
		return nil, "", fmt.Errorf("at least one of apiVersion, kind, name, or managedFields was changed")
	}
	return nil, "", fmt.Errorf("failed to build strategic merge patch: %w", err)
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
	copyObj := sanitizeForUpdate(obj, "")

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

// wrapKubernetesError keeps an API error unchanged, so its status (reason and
// field causes) reaches the frontend; other errors gain the operation name.
func wrapKubernetesError(err error, defaultMessage string) error {
	var status apierrors.APIStatus
	if errors.As(err, &status) {
		return err
	}
	return fmt.Errorf("%s: %w", defaultMessage, err)
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
