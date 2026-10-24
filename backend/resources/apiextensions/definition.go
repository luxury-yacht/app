package apiextensions

import (
	"slices"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/types"
)

// Definition is the part of a CustomResourceDefinition that API discovery and
// the dynamic custom-resource sources read. It is the Aggregate half of the
// CRD's ingest bundle; schemas and other spec detail are dropped at intake.
type Definition struct {
	Name          string
	UID           types.UID
	Group         string
	Scope         apiextensionsv1.ResourceScope
	Names         apiextensionsv1.CustomResourceDefinitionNames
	AcceptedNames apiextensionsv1.CustomResourceDefinitionNames
	Versions      []DefinitionVersion
	// Established reports the Established condition: the API is being served.
	Established bool
}

// DefinitionVersion is one version a definition declares.
type DefinitionVersion struct {
	Name    string
	Served  bool
	Storage bool
}

// BuildDefinition reduces a CRD to its Definition.
func BuildDefinition(crd *apiextensionsv1.CustomResourceDefinition) Definition {
	definition := Definition{
		Name:          crd.Name,
		UID:           crd.UID,
		Group:         crd.Spec.Group,
		Scope:         crd.Spec.Scope,
		Names:         crd.Spec.Names,
		AcceptedNames: crd.Status.AcceptedNames,
		Versions:      make([]DefinitionVersion, 0, len(crd.Spec.Versions)),
	}
	for _, version := range crd.Spec.Versions {
		definition.Versions = append(definition.Versions, DefinitionVersion{Name: version.Name, Served: version.Served, Storage: version.Storage})
	}
	for _, condition := range crd.Status.Conditions {
		if condition.Type == apiextensionsv1.Established {
			definition.Established = condition.Status == apiextensionsv1.ConditionTrue
			break
		}
	}
	return definition
}

// ChangesDiscovery reports whether two definitions differ in anything API
// discovery serves: identity, group, scope, names, served versions, or
// establishment. Status reasons, schemas, and unserved versions do not.
func (d Definition) ChangesDiscovery(other Definition) bool {
	return d.UID != other.UID || d.Group != other.Group || d.Scope != other.Scope ||
		!namesEqual(d.Names, other.Names) || !namesEqual(d.AcceptedNames, other.AcceptedNames) ||
		!slices.Equal(d.ServedVersions(), other.ServedVersions()) || d.Established != other.Established
}

// ServedVersions lists the served version names in sorted order.
func (d Definition) ServedVersions() []string {
	versions := make([]string, 0, len(d.Versions))
	for _, version := range d.Versions {
		if version.Served {
			versions = append(versions, version.Name)
		}
	}
	slices.Sort(versions)
	return versions
}

func namesEqual(a, b apiextensionsv1.CustomResourceDefinitionNames) bool {
	return a.Plural == b.Plural && a.Singular == b.Singular && a.Kind == b.Kind && a.ListKind == b.ListKind &&
		slices.Equal(a.ShortNames, b.ShortNames) && slices.Equal(a.Categories, b.Categories)
}
