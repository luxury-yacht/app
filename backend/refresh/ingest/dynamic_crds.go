package ingest

import (
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

// ReconcileCustomResourceDefinition selects a served API source and retains a
// healthy predecessor when the definition is incomplete.
func (m *IngestManager) ReconcileCustomResourceDefinition(definition apiextensions.Definition, preferredVersion string, project func(DynamicCatalogSpec) CatalogProjector) bool {
	spec, ok := customResourceSpec(definition, preferredVersion)
	if !ok || project == nil {
		return false
	}
	return m.ReconcileDynamicCatalogSource(spec, project(spec))
}

func customResourceSpec(definition apiextensions.Definition, preferredVersion string) (DynamicCatalogSpec, bool) {
	if definition.UID == "" || definition.Group == "" || definition.Names.Plural == "" || definition.Names.Kind == "" {
		return DynamicCatalogSpec{}, false
	}
	if definition.Scope != apiextensionsv1.NamespaceScoped && definition.Scope != apiextensionsv1.ClusterScoped {
		return DynamicCatalogSpec{}, false
	}
	version := servedCustomResourceVersion(definition.Versions, preferredVersion)
	if version == "" || registeredCustomResourceSource(definition) {
		return DynamicCatalogSpec{}, false
	}
	return DynamicCatalogSpec{
		GVR:        schema.GroupVersionResource{Group: definition.Group, Version: version, Resource: definition.Names.Plural},
		GVK:        schema.GroupVersionKind{Group: definition.Group, Version: version, Kind: definition.Names.Kind},
		Namespaced: definition.Scope == apiextensionsv1.NamespaceScoped, DefinitionUID: definition.UID,
	}, true
}

func servedCustomResourceVersion(versions []apiextensions.DefinitionVersion, preferred string) string {
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

// Match registry ownership and served versions, rather than maintaining a
// second list of first-class CRD-backed kinds (Gateway API) in the dynamic
// lifecycle.
func registeredCustomResourceSource(definition apiextensions.Definition) bool {
	for _, descriptor := range kindregistry.All {
		identity := descriptor.Identity
		if identity.Group != definition.Group || identity.Resource != definition.Names.Plural || identity.Kind != definition.Names.Kind {
			continue
		}
		if servedCustomResourceVersion(definition.Versions, identity.Version) == identity.Version {
			return true
		}
	}
	return false
}

// RemoveCustomResourceDefinition retires the matching CRD incarnation only.
func (m *IngestManager) RemoveCustomResourceDefinition(definition apiextensions.Definition) {
	if definition.UID == "" {
		return
	}
	gr := schema.GroupResource{Group: definition.Group, Resource: definition.Names.Plural}
	m.mu.Lock()
	if pending := m.dynamicAdmissions[gr]; pending != nil && pending.spec.DefinitionUID == definition.UID {
		delete(m.dynamicAdmissions, gr)
	}
	e := m.entryForGroupResourceLocked(gr)
	if e == nil || e.dynamic == nil || e.dynamic.spec.DefinitionUID != definition.UID {
		m.mu.Unlock()
		return
	}
	e.dynamic.retired.Store(true)
	m.mu.Unlock()
	m.joinDynamicRetirement(e)
}
