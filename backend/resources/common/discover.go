/*
 * backend/resources/common/discover.go
 *
 * Canonical kind-only GVR discovery used as a fallback by both the
 * legacy backend.getGVRForDependencies and generic.discoverGroupVersionResource
 * call sites. This is the "first match wins" walk that the kind-only
 * objects bug is fundamentally about — it exists for backwards
 * compatibility with callers that don't yet supply a full GVK. New code
 * should use ResolveGVRForGVK instead, which is strict and disambiguates
 * colliding kinds.
 *
 * Folding both legacy resolvers into this single canonical implementation
 * removes ~150 lines of duplicated discovery walks across the backend
 * package and the resources/generic package, and ensures behavior stays
 * consistent if the discovery semantics ever need updating.
 *
 * See docs/plans/kind-only-objects.md.
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
)

// kindOnlyDiscoveryTimeout bounds discovery walks initiated by
// DiscoverGVRByKind. Same value as the legacy `discoveryTimeout` constant
// in backend/object_yaml.go.
const kindOnlyDiscoveryTimeout = 10 * time.Second

// DiscoverGVRByKind walks the cluster's discovered API resources looking
// for one whose Kind, SingularName, or Resource (plural) name matches
// `resourceKind` (case-insensitive). Returns the first match.
//
// THIS FUNCTION IS NON-DETERMINISTIC FOR COLLIDING KINDS. If two CRDs
// share a Kind across different API groups, the result depends on the
// order discovery yields them, which can vary between API server
// versions and partial-discovery responses. New code MUST prefer
// ResolveGVRForGVK, which takes a fully-qualified GroupVersionKind.
//
// Falls back to the apiextensions CRD list (also kind-only) when
// discovery doesn't surface the kind. Returns an error when neither
// path finds a match.
func DiscoverGVRByKind(ctx context.Context, deps Dependencies, resourceKind string) (schema.GroupVersionResource, bool, error) {
	if deps.KubernetesClient == nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("kubernetes client not initialized")
	}
	if ctx == nil {
		ctx = deps.Context
		if ctx == nil {
			ctx = context.Background()
		}
	}
	walkCtx, cancel := context.WithTimeout(ctx, kindOnlyDiscoveryTimeout)
	defer cancel()

	discoveryClient := deps.KubernetesClient.Discovery()

	apiResourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && deps.Logger != nil {
		// Partial discovery failures are common with aggregated APIs;
		// continue with whatever lists we did get.
		deps.Logger.Debug(fmt.Sprintf("ServerPreferredResources returned error: %v", err), "DiscoverGVRByKind")
	}
	if len(apiResourceLists) == 0 {
		// Some fake discovery clients (client-go test fakes) leave
		// ServerPreferredResources unimplemented. Fall back to
		// ServerGroupsAndResources, which the same fakes do honor.
		if _, lists, altErr := discoveryClient.ServerGroupsAndResources(); altErr == nil && len(lists) > 0 {
			apiResourceLists = lists
		}
	}

	for _, apiResourceList := range apiResourceLists {
		gv, parseErr := schema.ParseGroupVersion(apiResourceList.GroupVersion)
		if parseErr != nil {
			continue
		}
		for _, apiResource := range apiResourceList.APIResources {
			// Skip subresources like pods/log, pods/exec.
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			if strings.EqualFold(apiResource.Kind, resourceKind) ||
				strings.EqualFold(apiResource.SingularName, resourceKind) ||
				strings.EqualFold(apiResource.Name, resourceKind) {
				return schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: apiResource.Name,
				}, apiResource.Namespaced, nil
			}
		}
	}

	if deps.APIExtensionsClient != nil {
		crds, listErr := deps.APIExtensionsClient.ApiextensionsV1().CustomResourceDefinitions().List(walkCtx, metav1.ListOptions{})
		if listErr == nil {
			for _, crd := range crds.Items {
				if !strings.EqualFold(crd.Spec.Names.Kind, resourceKind) {
					continue
				}
				isNamespaced := crd.Spec.Scope == apiextensionsv1.NamespaceScoped
				var version string
				for _, v := range crd.Spec.Versions {
					if v.Served && v.Storage {
						version = v.Name
						break
					}
				}
				if version == "" && len(crd.Spec.Versions) > 0 {
					version = crd.Spec.Versions[0].Name
				}
				return schema.GroupVersionResource{
					Group:    crd.Spec.Group,
					Version:  version,
					Resource: crd.Spec.Names.Plural,
				}, isNamespaced, nil
			}
		}
	}

	return schema.GroupVersionResource{}, false, fmt.Errorf("resource type %s not found", resourceKind)
}
