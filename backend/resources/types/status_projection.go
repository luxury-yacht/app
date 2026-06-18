/*
 * backend/resources/types/status_projection.go
 *
 * Shared status projection embedded in detail DTOs. The shared resource model
 * owns primary status; detail DTOs embed these projected fields so the status
 * fields are declared and populated in exactly one place.
 */

package types

import "github.com/luxury-yacht/app/backend/resourcemodel"

// StatusProjection holds the shared resource status fields projected from the
// shared resource model. Embed it (anonymously) in a detail DTO; Wails flattens
// the embedded fields into the generated TypeScript, so the wire/TS shape is
// identical to declaring the four fields inline.
type StatusProjection struct {
	Status             string `json:"status"`
	StatusState        string `json:"statusState,omitempty"`
	StatusPresentation string `json:"statusPresentation,omitempty"`
	StatusReason       string `json:"statusReason,omitempty"`
}

// NewStatusProjection projects the shared model's primary status into the DTO
// fields, replacing the per-builder `model.Status.*` assignments.
func NewStatusProjection(status resourcemodel.ResourceStatusPresentation) StatusProjection {
	return StatusProjection{
		Status:             status.Label,
		StatusState:        status.State,
		StatusPresentation: status.Presentation,
		StatusReason:       status.Reason,
	}
}
