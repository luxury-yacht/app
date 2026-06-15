/*
 * backend/resources/apiextensions/facts.go
 *
 * Canonical CustomResourceDefinition facts. Conditions reference the shared
 * ConditionFacts (resourcemodel); the names/version sub-types are CRD-only.
 */

package apiextensions

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical CustomResourceDefinition model facts.
type Facts struct {
	Group                   string                         `json:"group,omitempty"`
	Scope                   string                         `json:"scope,omitempty"`
	Names                   NamesFacts                     `json:"names"`
	Versions                []VersionFacts                 `json:"versions,omitempty"`
	Conditions              []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
	ConversionStrategy      string                         `json:"conversionStrategy,omitempty"`
	StorageVersion          string                         `json:"storageVersion,omitempty"`
	ExtraServedVersionCount int                            `json:"extraServedVersionCount,omitempty"`
}

// NamesFacts is the CRD names specification facts.
type NamesFacts struct {
	Plural     string   `json:"plural,omitempty"`
	Singular   string   `json:"singular,omitempty"`
	Kind       string   `json:"kind,omitempty"`
	ListKind   string   `json:"listKind,omitempty"`
	ShortNames []string `json:"shortNames,omitempty"`
	Categories []string `json:"categories,omitempty"`
}

// VersionFacts describes a single CRD version.
type VersionFacts struct {
	Name       string `json:"name"`
	Served     bool   `json:"served"`
	Storage    bool   `json:"storage"`
	Deprecated bool   `json:"deprecated"`
	HasSchema  bool   `json:"hasSchema"`
}
