package snapshot

import (
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func customResourceDefinitionsForScope(
	crds []*apiextensionsv1.CustomResourceDefinition,
	scope apiextensionsv1.ResourceScope,
) []*apiextensionsv1.CustomResourceDefinition {
	filtered := make([]*apiextensionsv1.CustomResourceDefinition, 0, len(crds))
	for _, crd := range crds {
		if isCustomResourceDefinitionForScope(crd, scope) {
			filtered = append(filtered, crd)
		}
	}
	return filtered
}

func isCustomResourceDefinitionForScope(
	crd *apiextensionsv1.CustomResourceDefinition,
	scope apiextensionsv1.ResourceScope,
) bool {
	return crd != nil && crd.Spec.Scope == scope && !IsFirstClassCustomResourceDefinition(crd)
}

func customResourceKinds(crds []*apiextensionsv1.CustomResourceDefinition) []string {
	kinds := make([]string, 0, len(crds))
	for _, crd := range crds {
		if crd != nil {
			kinds = append(kinds, crd.Spec.Names.Kind)
		}
	}
	return snapshotSortedUniqueStrings(kinds)
}

func customResourceGVR(crd *apiextensionsv1.CustomResourceDefinition) (schema.GroupVersionResource, bool) {
	version := preferredCRDVersion(crd)
	if version == "" {
		return schema.GroupVersionResource{}, false
	}
	return schema.GroupVersionResource{
		Group:    crd.Spec.Group,
		Version:  version,
		Resource: crd.Spec.Names.Plural,
	}, true
}
