/*
 * backend/resources/events/dto.go
 *
 * Event detail DTO (the frontend wire shape), co-located with its model and detail
 * builder.
 */

package events

import (
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Event is the flattened event row returned to the frontend.
type Event struct {
	Kind               string    `json:"kind"`
	EventType          string    `json:"eventType"`
	Reason             string    `json:"reason"`
	Message            string    `json:"message"`
	Count              int32     `json:"count"`
	FirstTimestamp     time.Time `json:"firstTimestamp"`
	LastTimestamp      time.Time `json:"lastTimestamp"`
	Source             string    `json:"source"`
	InvolvedObjectName string    `json:"involvedObjectName"`
	InvolvedObjectKind string    `json:"involvedObjectKind"`
	Namespace          string    `json:"namespace"`
}

// EventDetails is the complete Event payload rendered by the object panel.
type EventDetails struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	restypes.StatusProjection
	EventType               string                      `json:"eventType"`
	Reason                  string                      `json:"reason,omitempty"`
	Message                 string                      `json:"message,omitempty"`
	Count                   int32                       `json:"count"`
	FirstTimestamp          metav1.Time                 `json:"firstTimestamp"`
	LastTimestamp           metav1.Time                 `json:"lastTimestamp"`
	EventTime               *metav1.Time                `json:"eventTime,omitempty"`
	SeriesCount             *int32                      `json:"seriesCount,omitempty"`
	SeriesLastObservedTime  *metav1.Time                `json:"seriesLastObservedTime,omitempty"`
	Source                  string                      `json:"source,omitempty"`
	Action                  string                      `json:"action,omitempty"`
	ReportingController     string                      `json:"reportingController,omitempty"`
	ReportingInstance       string                      `json:"reportingInstance,omitempty"`
	InvolvedObject          *resourcemodel.ResourceLink `json:"involvedObject,omitempty"`
	InvolvedObjectFieldPath string                      `json:"involvedObjectFieldPath,omitempty"`
	RelatedObject           *resourcemodel.ResourceLink `json:"relatedObject,omitempty"`
	RelatedObjectFieldPath  string                      `json:"relatedObjectFieldPath,omitempty"`
	Labels                  map[string]string           `json:"labels,omitempty"`
	Annotations             map[string]string           `json:"annotations,omitempty"`
}
