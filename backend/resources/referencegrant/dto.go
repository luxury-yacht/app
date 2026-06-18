/*
 * backend/resources/referencegrant/dto.go
 *
 * ReferenceGrant detail DTO. Shared sub-types (ReferenceGrantFromInfo, RefOrDisplay)
 * stay in resources/types.
 */

package referencegrant

import "github.com/luxury-yacht/app/backend/resources/types"

// ReferenceGrantDetails is the detail payload for a ReferenceGrant.
type ReferenceGrantDetails struct {
	Kind        string                         `json:"kind"`
	Name        string                         `json:"name"`
	Namespace   string                         `json:"namespace"`
	Age         string                         `json:"age"`
	Details     string                         `json:"details"`
	From        []types.ReferenceGrantFromInfo `json:"from,omitempty"`
	To          []types.RefOrDisplay           `json:"to,omitempty"`
	Labels      map[string]string              `json:"labels,omitempty"`
	Annotations map[string]string              `json:"annotations,omitempty"`
}
