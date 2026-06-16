/*
 * backend/resources/gatewayclass/facts.go
 *
 * Semantic facts for GatewayClass. Shared primitives (ResourceLink, ConditionFacts,
 * ConditionsSummaryFacts) stay in resourcemodel.
 */

package gatewayclass

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the semantic model for a GatewayClass.
type Facts struct {
	ControllerName string                              `json:"controllerName,omitempty"`
	Parameters     *resourcemodel.ResourceLink         `json:"parameters,omitempty"`
	UsedBy         []resourcemodel.ResourceLink        `json:"usedBy,omitempty"`
	Conditions     []resourcemodel.ConditionFacts      `json:"conditions,omitempty"`
	Summary        resourcemodel.ConditionsSummaryFacts `json:"summary,omitempty"`
}
