/*
 * backend/resources/poddisruptionbudget/facts.go
 *
 * Canonical PodDisruptionBudget facts — the single typed extraction of a PDB's
 * intrinsic fields. Shared facts primitives are referenced from resourcemodel.
 */

package poddisruptionbudget

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical PodDisruptionBudget model facts.
type Facts struct {
	// Selector is nil when the spec has none (it matches no pods); an empty
	// selector matches every pod in the namespace.
	Selector       *LabelSelectorFacts             `json:"selector,omitempty"`
	MinAvailable   *resourcemodel.IntOrStringFacts `json:"minAvailable,omitempty"`
	MaxUnavailable *resourcemodel.IntOrStringFacts `json:"maxUnavailable,omitempty"`
	// UnhealthyPodEvictionPolicy is empty when unset (Kubernetes then applies IfHealthyBudget).
	UnhealthyPodEvictionPolicy string                            `json:"unhealthyPodEvictionPolicy,omitempty"`
	AllowedDisruptions         int32                             `json:"allowedDisruptions"`
	CurrentHealthy             int32                             `json:"currentHealthy"`
	DesiredHealthy             int32                             `json:"desiredHealthy"`
	ExpectedPods               int32                             `json:"expectedPods"`
	DisruptedPods              []resourcemodel.DisruptedPodFacts `json:"disruptedPods,omitempty"`
	Conditions                 []resourcemodel.ConditionFacts    `json:"conditions,omitempty"`
	ObservedGeneration         int64                             `json:"observedGeneration"`
}

// LabelSelectorFacts is the PDB pod selector, keeping match expressions.
type LabelSelectorFacts struct {
	MatchLabels      map[string]string               `json:"matchLabels,omitempty"`
	MatchExpressions []LabelSelectorRequirementFacts `json:"matchExpressions,omitempty"`
}

// LabelSelectorRequirementFacts is a single selector requirement.
type LabelSelectorRequirementFacts struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
}
