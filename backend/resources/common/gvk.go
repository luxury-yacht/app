/*
 * backend/resources/common/gvk.go
 *
 * Shared GVK → GVR resolver for resource handlers.
 *
 * Both the backend package (which holds the Wails app) and the generic
 * package (which implements generic delete) need to turn a fully-qualified
 * GroupVersionKind into a GroupVersionResource without relying on the
 * kind-only first-match-wins discovery walk..
 *
 * This function lives in common because:
 *   - backend/object_yaml_mutation.go already has a very similar helper
 *     (getGVRForGVKWithDependencies), but that helper is unexported and
 *     lives in package backend.
 *   - The backend package already imports backend/resources/generic, so
 *     the generic package cannot import backend back without creating a
 *     cycle.
 *   - common is the neutral shared package both backend and generic
 *     already depend on.
 *
 * This resolver is strict: if the requested group/version is not present
 * in discovery or in the CRD list, it returns an error rather than
 * falling back to a kind-only match. Callers that need the legacy
 * kind-only behavior should continue to use the existing
 * getGVRForDependencies path in the backend package.
 */

package common

import (
	"context"
	"fmt"
	"strings"
	"time"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

// defaultGVKResolveTimeout bounds the time spent talking to discovery and
// the apiextensions API during a single GVK resolution. Matches the
// mutationRequestTimeout used by the existing YAML edit path.
const defaultGVKResolveTimeout = 15 * time.Second

// ResolveGVRForGVK turns a fully-qualified GroupVersionKind into the
// matching GroupVersionResource + namespaced flag for the supplied
// cluster dependencies. It consults discovery first, then falls back to
// the CRD list for kinds that discovery hasn't picked up yet.
//
// Both the discovery walk and the CRD fallback require the group AND
// version to match the requested gvk. This is what makes ResolveGVRForGVK
// safe in the presence of colliding kinds across groups — the caller's
// choice of group wins, not the iteration order of the discovery client.
//
// Returns an error if deps has no KubernetesClient, if discovery cannot
// be reached, or if no resource matches the requested GVK.
func ResolveGVRForGVK(ctx context.Context, deps Dependencies, gvk schema.GroupVersionKind) (schema.GroupVersionResource, bool, error) {
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
		timeout := defaultGVKResolveTimeout
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
			deps.Logger.Debug(fmt.Sprintf("Discovery client fallback for GVK resolve: %v", err), "ResolveGVRForGVK")
		}
	}

	apiResourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && deps.Logger != nil {
		// Partial discovery failures are common with aggregated APIs;
		// continue with whatever lists we did get.
		deps.Logger.Debug(fmt.Sprintf("ServerPreferredResources returned error: %v", err), "ResolveGVRForGVK")
	}
	if len(apiResourceLists) == 0 {
		// The client-go fake discovery client leaves ServerPreferredResources
		// unimplemented (it literally returns nil, nil). ServerGroupsAndResources
		// does honor the seeded Resources slice, so use it as a fallback so
		// unit tests with fake discovery can exercise this code path.
		// Mirrors the workaround already used by
		// backend/resources/generic/generic.go discoverGroupVersionResource.
		if _, lists, altErr := discoveryClient.ServerGroupsAndResources(); altErr == nil && len(lists) > 0 {
			apiResourceLists = lists
		}
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
			// Skip subresources like pods/log, pods/exec.
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			if strings.EqualFold(apiResource.Kind, gvk.Kind) || strings.EqualFold(apiResource.SingularName, gvk.Kind) {
				return schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: apiResource.Name,
				}, apiResource.Namespaced, nil
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
				for idx := range crd.Spec.Versions {
					if crd.Spec.Versions[idx].Name == gvk.Version {
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
			deps.Logger.Debug(fmt.Sprintf("CRD discovery failed during ResolveGVRForGVK: %v", listErr), "ResolveGVRForGVK")
		}
	}

	return schema.GroupVersionResource{}, false, fmt.Errorf("unable to resolve resource for %s", gvk.String())
}
