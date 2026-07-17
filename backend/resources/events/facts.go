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
	EventType               string                      `json:"eventType,omitempty"`
	Reason                  string                      `json:"reason,omitempty"`
	Message                 string                      `json:"message,omitempty"`
	Count                   int32                       `json:"count"`
	Source                  string                      `json:"source,omitempty"`
	FirstTimestamp          metav1.Time                 `json:"firstTimestamp,omitempty"`
	LastTimestamp           metav1.Time                 `json:"lastTimestamp,omitempty"`
	EventTime               *metav1.Time                `json:"eventTime,omitempty"`
	SeriesCount             *int32                      `json:"seriesCount,omitempty"`
	SeriesLastObservedTime  *metav1.Time                `json:"seriesLastObservedTime,omitempty"`
	Action                  string                      `json:"action,omitempty"`
	ReportingController     string                      `json:"reportingController,omitempty"`
	ReportingInstance       string                      `json:"reportingInstance,omitempty"`
	InvolvedObject          *resourcemodel.ResourceLink `json:"involvedObject,omitempty"`
	InvolvedObjectFieldPath string                      `json:"involvedObjectFieldPath,omitempty"`
	RelatedObject           *resourcemodel.ResourceLink `json:"relatedObject,omitempty"`
	RelatedObjectFieldPath  string                      `json:"relatedObjectFieldPath,omitempty"`
}
