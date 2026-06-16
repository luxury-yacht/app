/*
 * backend/resources/listenerset/dto.go
 *
 * ListenerSet detail DTO. Shared sub-types stay in resources/types.
 */

package listenerset

import "github.com/luxury-yacht/app/backend/resources/types"

// ListenerSetDetails is the detail payload for a ListenerSet.
type ListenerSetDetails struct {
	Kind        string                         `json:"kind"`
	Name        string                         `json:"name"`
	Namespace   string                         `json:"namespace"`
	Age         string                         `json:"age"`
	Details     string                         `json:"details"`
	ParentRef   types.RefOrDisplay             `json:"parentRef"`
	Listeners   []types.GatewayListenerDetails `json:"listeners,omitempty"`
	Conditions  []types.ConditionState         `json:"conditions,omitempty"`
	Summary     types.ConditionsSummary        `json:"summary"`
	Labels      map[string]string              `json:"labels,omitempty"`
	Annotations map[string]string              `json:"annotations,omitempty"`
}
