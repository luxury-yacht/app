/*
 * backend/resources/events/facts.go
 *
 * Canonical Event facts. InvolvedObject references the shared resourcemodel
 * ResourceLink primitive.
 */

package events

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Facts is the canonical Event model facts.
type Facts struct {
	EventType      string                      `json:"eventType,omitempty"`
	Reason         string                      `json:"reason,omitempty"`
	Message        string                      `json:"message,omitempty"`
	Count          int32                       `json:"count"`
	Source         string                      `json:"source,omitempty"`
	FirstTimestamp metav1.Time                 `json:"firstTimestamp,omitempty"`
	LastTimestamp  metav1.Time                 `json:"lastTimestamp,omitempty"`
	InvolvedObject *resourcemodel.ResourceLink `json:"involvedObject,omitempty"`
}
