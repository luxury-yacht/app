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
	Selector           map[string]string                 `json:"selector,omitempty"`
	MinAvailable       *resourcemodel.IntOrStringFacts   `json:"minAvailable,omitempty"`
	MaxUnavailable     *resourcemodel.IntOrStringFacts   `json:"maxUnavailable,omitempty"`
	AllowedDisruptions int32                             `json:"allowedDisruptions"`
	CurrentHealthy     int32                             `json:"currentHealthy"`
	DesiredHealthy     int32                             `json:"desiredHealthy"`
	ExpectedPods       int32                             `json:"expectedPods"`
	DisruptedPods      []resourcemodel.DisruptedPodFacts `json:"disruptedPods,omitempty"`
	Conditions         []resourcemodel.ConditionFacts    `json:"conditions,omitempty"`
	ObservedGeneration int64                             `json:"observedGeneration"`
}
