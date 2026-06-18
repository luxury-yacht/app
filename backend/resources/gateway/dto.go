/*
 * backend/resources/gateway/dto.go
 *
 * Gateway detail DTO. Shared sub-types (ObjectRef, GatewayListenerDetails,
 * ConditionState, ConditionsSummary) stay in resources/types.
 */

package gateway

import "github.com/luxury-yacht/app/backend/resources/types"

// GatewayDetails is the detail payload for a Gateway.
type GatewayDetails struct {
	Kind            string                         `json:"kind"`
	Name            string                         `json:"name"`
	Namespace       string                         `json:"namespace"`
	Age             string                         `json:"age"`
	Details         string                         `json:"details"`
	GatewayClassRef types.ObjectRef                `json:"gatewayClassRef"`
	Addresses       []string                       `json:"addresses,omitempty"`
	Listeners       []types.GatewayListenerDetails `json:"listeners,omitempty"`
	Conditions      []types.ConditionState         `json:"conditions,omitempty"`
	Summary         types.ConditionsSummary        `json:"summary"`
	Labels          map[string]string              `json:"labels,omitempty"`
	Annotations     map[string]string              `json:"annotations,omitempty"`
}
