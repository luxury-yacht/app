/*
 * backend/resources/listenerset/facts.go
 *
 * ListenerSet facts. Shared primitives (ResourceLink, GatewayListenerFacts,
 * ConditionFacts, ConditionsSummaryFacts) stay in resourcemodel.
 */

package listenerset

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the semantic model for a ListenerSet.
type Facts struct {
	ParentRef  resourcemodel.ResourceLink           `json:"parentRef"`
	Listeners  []resourcemodel.GatewayListenerFacts `json:"listeners,omitempty"`
	Conditions []resourcemodel.ConditionFacts       `json:"conditions,omitempty"`
	Summary    resourcemodel.ConditionsSummaryFacts `json:"summary,omitempty"`
}
