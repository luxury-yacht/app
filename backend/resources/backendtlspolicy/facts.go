/*
 * backend/resources/backendtlspolicy/facts.go
 *
 * BackendTLSPolicy facts. Shared primitives (ResourceLink, ConditionFacts,
 * ConditionsSummaryFacts) stay in resourcemodel.
 */

package backendtlspolicy

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the semantic model for a BackendTLSPolicy.
type Facts struct {
	TargetRefs []resourcemodel.ResourceLink         `json:"targetRefs,omitempty"`
	Conditions []resourcemodel.ConditionFacts       `json:"conditions,omitempty"`
	Summary    resourcemodel.ConditionsSummaryFacts `json:"summary,omitempty"`
}
