package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	yamlutil "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/yaml"
)

const objectYAMLErrorPrefix = "ObjectYAMLError:"
const mutationRequestTimeout = 15 * time.Second

type diffLineType string

const (
	diffLineContext diffLineType = "context"
	diffLineAdded   diffLineType = "added"
	diffLineRemoved diffLineType = "removed"
)

type diffLine struct {
	Type            diffLineType `json:"type"`
	Value           string       `json:"value"`
	LeftLineNumber  *int         `json:"leftLineNumber,omitempty"`
	RightLineNumber *int         `json:"rightLineNumber,omitempty"`
}

type objectYAMLError struct {
	Code                   string     `json:"code"`
	Message                string     `json:"message"`
	Diff                   []diffLine `json:"diff,omitempty"`
	Truncated              bool       `json:"truncated,omitempty"`
	CurrentResourceVersion string     `json:"currentResourceVersion,omitempty"`
	Causes                 []string   `json:"causes,omitempty"`
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
	YAML            string `json:"yaml"`
	Kind            string `json:"kind"`
	APIVersion      string `json:"apiVersion"`
	Namespace       string `json:"namespace"`
	Name            string `json:"name"`
	ResourceVersion string `json:"resourceVersion"`
}

// ObjectYAMLMutationResponse returns basic metadata after a validation/apply attempt.
type ObjectYAMLMutationResponse struct {
	ResourceVersion string `json:"resourceVersion"`
}

type mutationContext struct {
	request      ObjectYAMLMutationRequest
	desired      *unstructured.Unstructured
	sanitized    *unstructured.Unstructured
	resource     dynamic.ResourceInterface
	current      *unstructured.Unstructured
	gvr          schema.GroupVersionResource
	isNamespaced bool
}

func (a *App) mutationContext() (context.Context, context.CancelFunc) {
	base := a.CtxOrBackground()
	if base == nil {
		base = context.Background()
	}
	if _, hasDeadline := base.Deadline(); hasDeadline {
		return base, func() {}
	}
	return context.WithTimeout(base, mutationRequestTimeout)
}

// ValidateObjectYaml performs a dry-run server-side apply to ensure the YAML is valid and safe to apply.
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

	result, err := mc.resource.Update(
		ctx,
		mc.sanitized.DeepCopy(),
		metav1.UpdateOptions{DryRun: []string{metav1.DryRunAll}},
	)
	if err != nil {
		return nil, wrapKubernetesError(err, "validation failed")
	}

	return &ObjectYAMLMutationResponse{
		ResourceVersion: result.GetResourceVersion(),
	}, nil
}

// ApplyObjectYaml performs a guarded update using the validated YAML.
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

	result, err := mc.resource.Update(
		ctx,
		mc.sanitized.DeepCopy(),
		metav1.UpdateOptions{},
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

	trimmedYAML := strings.TrimSpace(req.YAML)
	if trimmedYAML == "" {
		return nil, fmt.Errorf("YAML content is required")
	}

	if strings.TrimSpace(req.Kind) == "" || strings.TrimSpace(req.APIVersion) == "" {
		return nil, fmt.Errorf("apiVersion and kind are required")
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, fmt.Errorf("metadata.name is required")
	}
	if strings.TrimSpace(req.ResourceVersion) == "" {
		return nil, fmt.Errorf("metadata.resourceVersion is required")
	}

	desired, err := parseYAMLToUnstructured(trimmedYAML)
	if err != nil {
		return nil, err
	}

	// Identity validation
	if !strings.EqualFold(req.Kind, desired.GetKind()) {
		return nil, fmt.Errorf("kind mismatch: expected %s, found %s", req.Kind, desired.GetKind())
	}
	if req.APIVersion != desired.GetAPIVersion() {
		return nil, fmt.Errorf("apiVersion mismatch: expected %s, found %s", req.APIVersion, desired.GetAPIVersion())
	}
	if req.Name != desired.GetName() {
		return nil, fmt.Errorf("metadata.name mismatch: expected %s, found %s", req.Name, desired.GetName())
	}

	if req.Namespace != "" && desired.GetNamespace() != req.Namespace {
		return nil, fmt.Errorf(
			"metadata.namespace mismatch: expected %s, found %s",
			namespaceLabel(req.Namespace),
			namespaceLabel(desired.GetNamespace()),
		)
	}

	if desired.GetKind() == "List" {
		return nil, fmt.Errorf("list objects are not supported in YAML editor")
	}

	if desired.GetResourceVersion() == "" {
		return nil, fmt.Errorf("metadata.resourceVersion must be present in the YAML to prevent overwrites")
	}

	if desired.GetResourceVersion() != req.ResourceVersion {
		return nil, fmt.Errorf("metadata.resourceVersion mismatch: YAML has %s but editor tracked %s", desired.GetResourceVersion(), req.ResourceVersion)
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

	if current.GetResourceVersion() != req.ResourceVersion {
		currentYAML, err := normalizeObjectYAML(current)
		if err != nil {
			return nil, err
		}
		diff, truncated := computeDiffLines(currentYAML, req.YAML)
		return nil, &objectYAMLError{
			Code:                   "ResourceVersionMismatch",
			Message:                fmt.Sprintf("object has changed since editing began: current resourceVersion is %s, editor tracked %s", current.GetResourceVersion(), req.ResourceVersion),
			Diff:                   diff,
			Truncated:              truncated,
			CurrentResourceVersion: current.GetResourceVersion(),
		}
	}

	if isNamespaced && current.GetNamespace() != desired.GetNamespace() {
		return nil, fmt.Errorf("live object namespace %s does not match YAML namespace %s", namespaceLabel(current.GetNamespace()), namespaceLabel(desired.GetNamespace()))
	}

	sanitized := sanitizeForUpdate(desired, req.ResourceVersion)

	return &mutationContext{
		request:      req,
		desired:      desired,
		sanitized:    sanitized,
		resource:     resource,
		current:      current,
		gvr:          gvr,
		isNamespaced: isNamespaced,
	}, nil
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

const maxDiffLineCount = 800

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

func computeDiffLines(before, after string) ([]diffLine, bool) {
	before = strings.TrimSuffix(before, "\n")
	after = strings.TrimSuffix(after, "\n")
	left := strings.Split(before, "\n")
	right := strings.Split(after, "\n")
	if before == "" {
		left = []string{}
	}
	if after == "" {
		right = []string{}
	}

	if len(left)+len(right) > maxDiffLineCount {
		return nil, true
	}

	dp := buildDiffMatrix(left, right)
	lines := make([]diffLine, 0, len(left)+len(right))
	i, j := 0, 0
	leftLine := 1
	rightLine := 1

	for i < len(left) && j < len(right) {
		if left[i] == right[j] {
			lines = append(lines, diffLine{
				Type:            diffLineContext,
				Value:           left[i],
				LeftLineNumber:  intPtr(leftLine),
				RightLineNumber: intPtr(rightLine),
			})
			i++
			j++
			leftLine++
			rightLine++
			continue
		}

		if dp[i+1][j] >= dp[i][j+1] {
			lines = append(lines, diffLine{
				Type:           diffLineRemoved,
				Value:          left[i],
				LeftLineNumber: intPtr(leftLine),
			})
			i++
			leftLine++
		} else {
			lines = append(lines, diffLine{
				Type:            diffLineAdded,
				Value:           right[j],
				RightLineNumber: intPtr(rightLine),
			})
			j++
			rightLine++
		}
	}

	for ; i < len(left); i++ {
		lines = append(lines, diffLine{
			Type:           diffLineRemoved,
			Value:          left[i],
			LeftLineNumber: intPtr(leftLine),
		})
		leftLine++
	}

	for ; j < len(right); j++ {
		lines = append(lines, diffLine{
			Type:            diffLineAdded,
			Value:           right[j],
			RightLineNumber: intPtr(rightLine),
		})
		rightLine++
	}

	return lines, false
}

func buildDiffMatrix(left, right []string) [][]int {
	rows := len(left) + 1
	cols := len(right) + 1
	dp := make([][]int, rows)
	for idx := range dp {
		dp[idx] = make([]int, cols)
	}
	for i := len(left) - 1; i >= 0; i-- {
		for j := len(right) - 1; j >= 0; j-- {
			if left[i] == right[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}
	return dp
}

func intPtr(v int) *int {
	return &v
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
				if cause.Message == "" && cause.Field == "" {
					continue
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
				causes = append(causes, builder.String())
			}
		}

		return &objectYAMLError{
			Code:    code,
			Message: statusErr.Error(),
			Causes:  causes,
		}
	}

	return fmt.Errorf("%s: %w", defaultMessage, err)
}

func (a *App) getGVRForGVK(ctx context.Context, gvk schema.GroupVersionKind) (schema.GroupVersionResource, bool, error) {
	return getGVRForGVKWithDependencies(ctx, a.resourceDependencies(), a.currentSelectionKey(), gvk)
}

func getGVRForGVKWithDependencies(
	ctx context.Context,
	deps common.Dependencies,
	selectionKey string,
	gvk schema.GroupVersionKind,
) (schema.GroupVersionResource, bool, error) {
	if deps.KubernetesClient == nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("kubernetes client not initialized")
	}

	if ctx == nil {
		ctx = deps.Context
		if ctx == nil {
			ctx = context.Background()
		}
	}

	discoveryClient := deps.KubernetesClient.Discovery()
	if deps.RestConfig != nil {
		timeout := mutationRequestTimeout
		if deadline, ok := ctx.Deadline(); ok {
			if remaining := time.Until(deadline); remaining > 0 && remaining < timeout {
				timeout = remaining
			}
		}
		cfg := rest.CopyConfig(deps.RestConfig)
		cfg.Timeout = timeout
		if dc, err := discovery.NewDiscoveryClientForConfig(cfg); err == nil {
			discoveryClient = dc
		} else if deps.Logger != nil {
			deps.Logger.Debug(fmt.Sprintf("Discovery client fallback for YAML mutation: %v", err), "ObjectYAML")
		}
	}

	apiResourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && deps.Logger != nil {
		// Partial discovery failures are common with aggregated APIs; continue with what we have.
		deps.Logger.Debug(fmt.Sprintf("ServerPreferredResources returned error: %v", err), "ObjectYAML")
	}

	for _, apiResourceList := range apiResourceLists {
		gv, parseErr := schema.ParseGroupVersion(apiResourceList.GroupVersion)
		if parseErr != nil {
			continue
		}
		if gv.Group != gvk.Group || gv.Version != gvk.Version {
			continue
		}

		for _, apiResource := range apiResourceList.APIResources {
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			if strings.EqualFold(apiResource.Kind, gvk.Kind) || strings.EqualFold(apiResource.SingularName, gvk.Kind) {
				gvr := schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: apiResource.Name,
				}
				return gvr, apiResource.Namespaced, nil
			}
		}
	}

	if deps.APIExtensionsClient != nil {
		crds, listErr := deps.APIExtensionsClient.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
		if listErr == nil {
			for _, crd := range crds.Items {
				if !strings.EqualFold(crd.Spec.Names.Kind, gvk.Kind) {
					continue
				}
				if crd.Spec.Group != gvk.Group {
					continue
				}

				var versionMatch *apiextensionsv1.CustomResourceDefinitionVersion
				for idx, version := range crd.Spec.Versions {
					if version.Name == gvk.Version {
						versionMatch = &crd.Spec.Versions[idx]
						break
					}
				}

				if versionMatch == nil {
					continue
				}

				return schema.GroupVersionResource{
						Group:    crd.Spec.Group,
						Version:  versionMatch.Name,
						Resource: crd.Spec.Names.Plural,
					},
					crd.Spec.Scope == apiextensionsv1.NamespaceScoped,
					nil
			}
		} else if deps.Logger != nil {
			deps.Logger.Debug(fmt.Sprintf("CRD discovery failed: %v", listErr), "ObjectYAML")
		}
	}

	// Fallback to legacy GVR resolution by Kind if group/version-specific lookup fails.
	if fallbackGVR, namespaced, err := getGVRForDependencies(deps, selectionKey, gvk.Kind); err == nil {
		if (gvk.Group == "" || strings.EqualFold(fallbackGVR.Group, gvk.Group)) &&
			(gvk.Version == "" || strings.EqualFold(fallbackGVR.Version, gvk.Version)) {
			return fallbackGVR, namespaced, nil
		}
	}

	return schema.GroupVersionResource{}, false, fmt.Errorf("unable to resolve resource for %s", gvk.String())
}
