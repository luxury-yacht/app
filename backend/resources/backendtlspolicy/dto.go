/*
 * backend/resources/backendtlspolicy/dto.go
 *
 * BackendTLSPolicy detail DTO. Shared sub-types stay in resources/types.
 */

package backendtlspolicy

import "github.com/luxury-yacht/app/backend/resources/types"

// BackendTLSPolicyDetails is the detail payload for a BackendTLSPolicy.
type BackendTLSPolicyDetails struct {
	Kind        string                  `json:"kind"`
	Name        string                  `json:"name"`
	Namespace   string                  `json:"namespace"`
	Age         string                  `json:"age"`
	Details     string                  `json:"details"`
	TargetRefs  []types.RefOrDisplay    `json:"targetRefs,omitempty"`
	Conditions  []types.ConditionState  `json:"conditions,omitempty"`
	Summary     types.ConditionsSummary `json:"summary"`
	Labels      map[string]string       `json:"labels,omitempty"`
	Annotations map[string]string       `json:"annotations,omitempty"`
}
