package ingest

import (
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// ReconcileCustomResourceDefinition selects a served API source and retains a
// healthy predecessor when the definition is incomplete.
func (m *IngestManager) ReconcileCustomResourceDefinition(crd *apiextensionsv1.CustomResourceDefinition, preferredVersion string, project func(DynamicCatalogSpec) CatalogProjector) bool {
	spec, ok := customResourceSpec(crd, preferredVersion)
	if !ok || project == nil {
		return false
	}
	return m.ReconcileDynamicCatalogSource(spec, project(spec))
}

func customResourceSpec(crd *apiextensionsv1.CustomResourceDefinition, preferredVersion string) (DynamicCatalogSpec, bool) {
	if crd == nil || crd.UID == "" || crd.Spec.Group == "" || crd.Spec.Names.Plural == "" || crd.Spec.Names.Kind == "" {
		return DynamicCatalogSpec{}, false
	}
	if crd.Spec.Scope != apiextensionsv1.NamespaceScoped && crd.Spec.Scope != apiextensionsv1.ClusterScoped {
		return DynamicCatalogSpec{}, false
	}
	version := servedCustomResourceVersion(crd.Spec.Versions, preferredVersion)
	if version == "" || registeredCustomResourceSource(crd) {
		return DynamicCatalogSpec{}, false
	}
	return DynamicCatalogSpec{
		GVR:        schema.GroupVersionResource{Group: crd.Spec.Group, Version: version, Resource: crd.Spec.Names.Plural},
		GVK:        schema.GroupVersionKind{Group: crd.Spec.Group, Version: version, Kind: crd.Spec.Names.Kind},
		Namespaced: crd.Spec.Scope == apiextensionsv1.NamespaceScoped, DefinitionUID: crd.UID,
	}, true
}

func servedCustomResourceVersion(versions []apiextensionsv1.CustomResourceDefinitionVersion, preferred string) string {
	selected := ""
	for _, version := range versions {
		if !version.Served || version.Name == "" {
			continue
		}
		if version.Name == preferred {
			return version.Name
		}
		if selected == "" || version.Storage {
			selected = version.Name
		}
	}
	return selected
}

// Match registry source facets and served versions, rather than maintaining a
// second list of first-class Gateway CRDs in the dynamic lifecycle.
func registeredCustomResourceSource(crd *apiextensionsv1.CustomResourceDefinition) bool {
	for _, descriptor := range kindregistry.All {
		identity := descriptor.Identity
		if identity.Group != crd.Spec.Group || identity.Resource != crd.Spec.Names.Plural || identity.Kind != crd.Spec.Names.Kind {
			continue
		}
		if descriptor.IngestOwned || descriptor.CatalogSource == kindspec.CatalogShared || descriptor.CatalogSource == kindspec.CatalogGateway || descriptor.CatalogSource == kindspec.CatalogAPIExtensions {
			if servedCustomResourceVersion(crd.Spec.Versions, identity.Version) == identity.Version {
				return true
			}
		}
	}
	return false
}

// RemoveCustomResourceDefinition retires the matching CRD incarnation only.
func (m *IngestManager) RemoveCustomResourceDefinition(crd *apiextensionsv1.CustomResourceDefinition) {
	if crd == nil || crd.UID == "" {
		return
	}
	gr := schema.GroupResource{Group: crd.Spec.Group, Resource: crd.Spec.Names.Plural}
	m.mu.Lock()
	if pending := m.dynamicAdmissions[gr]; pending != nil && pending.spec.DefinitionUID == crd.UID {
		delete(m.dynamicAdmissions, gr)
	}
	e := m.entryForGroupResourceLocked(gr)
	if e == nil || e.dynamic == nil || e.dynamic.spec.DefinitionUID != crd.UID {
		m.mu.Unlock()
		return
	}
	e.dynamic.retired.Store(true)
	m.mu.Unlock()
	m.joinDynamicRetirement(e)
}
