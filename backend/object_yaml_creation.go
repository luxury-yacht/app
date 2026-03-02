package backend

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/templates"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

// GetResourceTemplates returns all available starter templates for resource creation.
// This method does not require a cluster connection.
func (a *App) GetResourceTemplates() []templates.ResourceTemplate {
	return templates.GetAll()
}

// ResourceCreationRequest captures the YAML and optional namespace override
// for creating a new Kubernetes resource.
type ResourceCreationRequest struct {
	YAML      string `json:"yaml"`
	Namespace string `json:"namespace"` // optional; overrides YAML metadata.namespace for namespaced resources
}

// ResourceCreationResponse returns metadata about the newly created resource.
type ResourceCreationResponse struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	Kind            string `json:"kind"`
	APIVersion      string `json:"apiVersion"`
	ResourceVersion string `json:"resourceVersion"`
}

// ValidateResourceCreation performs a server-side dry-run create to check
// whether the YAML would produce a valid resource.
func (a *App) ValidateResourceCreation(clusterID string, req ResourceCreationRequest) (*ResourceCreationResponse, error) {
	mc, err := a.prepareCreationContext(clusterID, req)
	if err != nil {
		return nil, err
	}

	ctx, cancel := a.mutationContext()
	defer cancel()

	result, err := mc.resource.Create(
		ctx,
		mc.obj,
		metav1.CreateOptions{DryRun: []string{metav1.DryRunAll}},
	)
	if err != nil {
		return nil, wrapKubernetesError(err, "validation failed")
	}

	return &ResourceCreationResponse{
		Name:            result.GetName(),
		Namespace:       result.GetNamespace(),
		Kind:            result.GetKind(),
		APIVersion:      result.GetAPIVersion(),
		ResourceVersion: result.GetResourceVersion(),
	}, nil
}

// CreateResource creates a new Kubernetes resource from the provided YAML.
func (a *App) CreateResource(clusterID string, req ResourceCreationRequest) (*ResourceCreationResponse, error) {
	mc, err := a.prepareCreationContext(clusterID, req)
	if err != nil {
		return nil, err
	}

	ctx, cancel := a.mutationContext()
	defer cancel()

	result, err := mc.resource.Create(
		ctx,
		mc.obj,
		metav1.CreateOptions{},
	)
	if err != nil {
		return nil, wrapKubernetesError(err, "create failed")
	}

	deps, _, _ := a.resolveClusterDependencies(clusterID)
	if deps.Logger != nil {
		deps.Logger.Info(fmt.Sprintf("Created %s/%s in namespace %q", result.GetKind(), result.GetName(), result.GetNamespace()), "ResourceCreation")
	}

	return &ResourceCreationResponse{
		Name:            result.GetName(),
		Namespace:       result.GetNamespace(),
		Kind:            result.GetKind(),
		APIVersion:      result.GetAPIVersion(),
		ResourceVersion: result.GetResourceVersion(),
	}, nil
}

// creationContext holds resolved state for a create operation.
type creationContext struct {
	obj      *unstructured.Unstructured
	resource dynamic.ResourceInterface
	gvr      schema.GroupVersionResource
}

// prepareCreationContext parses YAML, resolves the GVR, applies namespace
// override, and returns a ready-to-use creation context.
func (a *App) prepareCreationContext(clusterID string, req ResourceCreationRequest) (*creationContext, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}

	if deps.KubernetesClient == nil || deps.DynamicClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	trimmedYAML := strings.TrimSpace(req.YAML)
	if trimmedYAML == "" {
		return nil, fmt.Errorf("YAML content is required")
	}

	obj, err := parseYAMLToUnstructured(trimmedYAML)
	if err != nil {
		return nil, err
	}

	if obj.GetKind() == "" || obj.GetAPIVersion() == "" {
		return nil, fmt.Errorf("apiVersion and kind are required")
	}

	if obj.GetName() == "" {
		return nil, fmt.Errorf("metadata.name is required")
	}

	if obj.GetKind() == "List" {
		return nil, fmt.Errorf("list objects are not supported; create one resource at a time")
	}

	// Strip fields that should not be set on new resources.
	obj.SetResourceVersion("")
	obj.SetUID("")
	obj.SetCreationTimestamp(metav1.Time{})
	unstructured.RemoveNestedField(obj.Object, "metadata", "managedFields")
	unstructured.RemoveNestedField(obj.Object, "metadata", "selfLink")
	unstructured.RemoveNestedField(obj.Object, "status")

	gvk := schema.FromAPIVersionAndKind(obj.GetAPIVersion(), obj.GetKind())

	ctx, cancel := a.mutationContext()
	defer cancel()

	// Strict GVR resolution for creation — no kind-only fallback.
	// Unlike editing (which uses getGVRForGVKWithDependencies with its
	// getGVRForDependencies fallback), creation must fail hard on ambiguity
	// to prevent cross-group collisions (e.g., same Kind in different API groups).
	gvr, isNamespaced, err := resolveGVRStrict(ctx, deps, gvk)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve resource mapping for %s: %w", gvk.String(), err)
	}

	// Apply namespace override for namespaced resources.
	if isNamespaced {
		if req.Namespace != "" {
			obj.SetNamespace(req.Namespace)
		}
		if obj.GetNamespace() == "" {
			return nil, fmt.Errorf("namespaced resources require a namespace; set metadata.namespace or provide a namespace override")
		}
	} else {
		obj.SetNamespace("")
	}

	var resource dynamic.ResourceInterface
	if isNamespaced {
		resource = deps.DynamicClient.Resource(gvr).Namespace(obj.GetNamespace())
	} else {
		resource = deps.DynamicClient.Resource(gvr)
	}

	return &creationContext{
		obj:      obj,
		resource: resource,
		gvr:      gvr,
	}, nil
}

// resolveGVRStrict performs strict GVK→GVR resolution using API discovery
// and CRD lookup. Unlike getGVRForGVKWithDependencies, this does NOT fall
// back to kind-only matching via getGVRForDependencies. If the exact
// group/version/kind cannot be resolved, it returns an error.
func resolveGVRStrict(
	ctx context.Context,
	deps common.Dependencies,
	gvk schema.GroupVersionKind,
) (schema.GroupVersionResource, bool, error) {
	if deps.KubernetesClient == nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("kubernetes client not initialized")
	}

	// Use a timeout-safe discovery client (same pattern as object_yaml_mutation.go).
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
			deps.Logger.Debug(fmt.Sprintf("Discovery client fallback for resource creation: %v", err), "ResourceCreation")
		}
	}

	// Use ServerGroupsAndResources instead of ServerPreferredResources so we
	// check all API versions, not just the preferred one per group. A user
	// creating a resource with an explicit apiVersion should succeed even if
	// that version is not the cluster's preferred version for the group.
	_, apiResourceLists, err := discoveryClient.ServerGroupsAndResources()
	if err != nil && deps.Logger != nil {
		// Partial discovery failures are common with aggregated APIs; continue with what we have.
		deps.Logger.Debug(fmt.Sprintf("ServerGroupsAndResources returned error: %v", err), "ResourceCreation")
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
			if strings.EqualFold(apiResource.Kind, gvk.Kind) {
				return schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: apiResource.Name,
				}, apiResource.Namespaced, nil
			}
		}
	}

	// Check CRDs as secondary lookup.
	if deps.APIExtensionsClient != nil {
		crds, listErr := deps.APIExtensionsClient.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
		if listErr == nil {
			for _, crd := range crds.Items {
				if !strings.EqualFold(crd.Spec.Names.Kind, gvk.Kind) || crd.Spec.Group != gvk.Group {
					continue
				}
				for _, version := range crd.Spec.Versions {
					if version.Name == gvk.Version {
						return schema.GroupVersionResource{
							Group:    crd.Spec.Group,
							Version:  version.Name,
							Resource: crd.Spec.Names.Plural,
						}, crd.Spec.Scope == apiextensionsv1.NamespaceScoped, nil
					}
				}
			}
		}
	}

	return schema.GroupVersionResource{}, false, fmt.Errorf(
		"unable to resolve resource for %s; ensure apiVersion and kind are correct", gvk.String(),
	)
}
