/*
 * backend/resources/gateway/facts.go
 *
 * Gateway facts. Shared primitives (ResourceLink, GatewayListenerFacts,
 * ConditionFacts, ConditionsSummaryFacts) stay in resourcemodel.
 */

package gateway

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the semantic model for a Gateway.
type Facts struct {
	Class      *resourcemodel.ResourceLink          `json:"class,omitempty"`
	Addresses  []string                             `json:"addresses,omitempty"`
	Listeners  []resourcemodel.GatewayListenerFacts `json:"listeners,omitempty"`
	Conditions []resourcemodel.ConditionFacts       `json:"conditions,omitempty"`
	Summary    resourcemodel.ConditionsSummaryFacts `json:"summary,omitempty"`
}
