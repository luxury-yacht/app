/*
 * backend/refresh/objectmap/status.go
 *
 * Neutral object-map status type. Lives in its own leaf package (depends only on
 * resourcemodel) so per-kind packages can produce an object-map status from their
 * model without importing the snapshot package — which would otherwise cycle.
 */

package objectmap

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// Status is the object-map node status projection.
type Status struct {
	State        string `json:"state"`
	Label        string `json:"label"`
	Presentation string `json:"presentation,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

// New builds a Status, taking the first non-blank reason.
func New(state, label string, reasons ...string) *Status {
	status := &Status{State: state, Label: label}
	for _, reason := range reasons {
		if strings.TrimSpace(reason) != "" {
			status.Reason = reason
			break
		}
	}
	return status
}

// FromResourceModel projects a resource model's status into an object-map Status.
func FromResourceModel(model resourcemodel.ResourceModel) *Status {
	status := New(model.Status.State, model.Status.Label, model.Status.Reason)
	status.Presentation = model.Status.Presentation
	return status
}
