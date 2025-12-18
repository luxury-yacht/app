package objectcatalog

import (
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/sets"
)

// ExtractDescriptors converts API resource discovery results into catalog descriptors.
func ExtractDescriptors(resourceLists []*metav1.APIResourceList) []Descriptor {
	excludedKinds := sets.NewString(
		"Event",
		"ComponentStatus", // Deprecated since Kubernetes v1.19; avoid hitting the legacy endpoint.
	)
	result := make([]Descriptor, 0)

	for _, list := range resourceLists {
		groupVersion, parseErr := schema.ParseGroupVersion(list.GroupVersion)
		if parseErr != nil {
			continue
		}

		for _, apiResource := range list.APIResources {
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			if apiResource.Kind == "" || excludedKinds.Has(apiResource.Kind) {
				continue
			}
			if !containsVerb(apiResource.Verbs, "list") {
				continue
			}

			scope := ScopeCluster
			if apiResource.Namespaced {
				scope = ScopeNamespace
			}

			result = append(result, Descriptor{
				Group:      groupVersion.Group,
				Version:    groupVersion.Version,
				Resource:   apiResource.Name,
				Kind:       apiResource.Kind,
				Scope:      scope,
				Namespaced: apiResource.Namespaced,
			})
		}
	}

	return result
}
