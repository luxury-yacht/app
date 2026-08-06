/*
 * backend/resources/common/discover.go
 *
 * Canonical kind-only GVR discovery used as a fallback by both the
 * legacy backend.getGVRForDependencies and generic.discoverGroupVersionResource
 * call sites. This is the "first match wins" walk that the kind-only
 * objects bug is fundamentally about — it exists for backwards
 * compatibility with callers that don't yet supply a full GVK. New code
 * should use Dependencies.ResourceResolver instead, which is strict and
 * disambiguates colliding kinds.
 *
 * Folding both legacy resolvers into this single canonical implementation
 * removes ~150 lines of duplicated discovery walks across the backend
 * package and the resources/generic package, and ensures behavior stays
 * consistent if the discovery semantics ever need updating.
 */

package common

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// DiscoverGVRByKind walks the cluster's discovered API resources looking
// for one whose Kind, SingularName, or Resource (plural) name matches
// `resourceKind` (case-insensitive). Returns the first match.
//
// THIS FUNCTION IS NON-DETERMINISTIC FOR COLLIDING KINDS. If two CRDs
// share a Kind across different API groups, the result depends on the
// order discovery yields them, which can vary between API server
// versions and partial-discovery responses. New code MUST prefer
// Dependencies.ResourceResolver, which takes a fully-qualified
// GroupVersionKind.
//
// Falls back to the apiextensions CRD list (also kind-only) when
// discovery doesn't surface the kind. Returns an error when neither
// path finds a match.
func DiscoverGVRByKind(ctx context.Context, deps Dependencies, resourceKind string) (schema.GroupVersionResource, bool, error) {
	if deps.KubernetesClient == nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("kubernetes client not initialized")
	}
	ctx = kindDiscoveryContext(ctx, deps.Context)
	walkCtx, cancel := context.WithTimeout(ctx, config.KindOnlyDiscoveryTimeout)
	defer cancel()

	if result, found := findDiscoveredKind(kindDiscoveryResourceLists(deps), resourceKind); found {
		return result.gvr, result.namespaced, nil
	}
	if result, found := findCRDKind(walkCtx, deps, resourceKind); found {
		return result.gvr, result.namespaced, nil
	}
	return schema.GroupVersionResource{}, false, fmt.Errorf("resource type %s not found", resourceKind)
}

type discoveredKind struct {
	gvr        schema.GroupVersionResource
	namespaced bool
}

func kindDiscoveryContext(ctx, fallback context.Context) context.Context {
	if ctx != nil {
		return ctx
	}
	if fallback != nil {
		return fallback
	}
	return context.Background()
}

func kindDiscoveryResourceLists(deps Dependencies) []*metav1.APIResourceList {
	discoveryClient := deps.KubernetesClient.Discovery()
	lists, err := discoveryClient.ServerPreferredResources()
	if err != nil {
		// Aggregated APIs commonly fail partially; their successful lists remain usable.
		applog.Debug(deps.Logger, fmt.Sprintf("ServerPreferredResources returned error: %v", err), "DiscoverGVRByKind")
	}
	if len(lists) > 0 {
		return lists
	}
	_, fallback, fallbackErr := discoveryClient.ServerGroupsAndResources()
	if fallbackErr == nil && len(fallback) > 0 {
		return fallback
	}
	return lists
}

func findDiscoveredKind(lists []*metav1.APIResourceList, resourceKind string) (discoveredKind, bool) {
	for _, list := range lists {
		gv, err := schema.ParseGroupVersion(list.GroupVersion)
		if err != nil {
			continue
		}
		for _, resource := range list.APIResources {
			if resourceMatchesKind(resource, resourceKind) {
				return discoveredKind{
					gvr:        schema.GroupVersionResource{Group: gv.Group, Version: gv.Version, Resource: resource.Name},
					namespaced: resource.Namespaced,
				}, true
			}
		}
	}
	return discoveredKind{}, false
}

func resourceMatchesKind(resource metav1.APIResource, resourceKind string) bool {
	if strings.Contains(resource.Name, "/") {
		return false
	}
	return strings.EqualFold(resource.Kind, resourceKind) ||
		strings.EqualFold(resource.SingularName, resourceKind) ||
		strings.EqualFold(resource.Name, resourceKind)
}

func findCRDKind(ctx context.Context, deps Dependencies, resourceKind string) (discoveredKind, bool) {
	if deps.APIExtensionsClient == nil {
		return discoveredKind{}, false
	}
	crds, err := deps.APIExtensionsClient.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
	if err != nil {
		return discoveredKind{}, false
	}
	for _, crd := range crds.Items {
		if strings.EqualFold(crd.Spec.Names.Kind, resourceKind) {
			return discoveredKind{
				gvr: schema.GroupVersionResource{
					Group: crd.Spec.Group, Version: preferredCRDVersion(crd), Resource: crd.Spec.Names.Plural,
				},
				namespaced: crd.Spec.Scope == apiextensionsv1.NamespaceScoped,
			}, true
		}
	}
	return discoveredKind{}, false
}

func preferredCRDVersion(crd apiextensionsv1.CustomResourceDefinition) string {
	for _, version := range crd.Spec.Versions {
		if version.Served && version.Storage {
			return version.Name
		}
	}
	if len(crd.Spec.Versions) > 0 {
		return crd.Spec.Versions[0].Name
	}
	return ""
}
