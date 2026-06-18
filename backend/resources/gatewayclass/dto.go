/*
 * backend/resources/gatewayclass/dto.go
 *
 * GatewayClass detail DTO (wire shape). Shared sub-types (ConditionState,
 * ConditionsSummary, RefOrDisplay, ObjectRef) stay in resources/types.
 */

package gatewayclass

import "github.com/luxury-yacht/app/backend/resources/types"

// GatewayClassDetails is the detail payload for a GatewayClass.
type GatewayClassDetails struct {
	Kind        string                  `json:"kind"`
	Name        string                  `json:"name"`
	Controller  string                  `json:"controller"`
	Age         string                  `json:"age"`
	Details     string                  `json:"details"`
	Conditions  []types.ConditionState  `json:"conditions,omitempty"`
	Summary     types.ConditionsSummary `json:"summary"`
	Parameters  *types.RefOrDisplay     `json:"parameters,omitempty"`
	UsedBy      []types.ObjectRef       `json:"usedBy,omitempty"`
	Labels      map[string]string       `json:"labels,omitempty"`
	Annotations map[string]string       `json:"annotations,omitempty"`
}
