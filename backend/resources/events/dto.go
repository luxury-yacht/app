/*
 * backend/resources/events/dto.go
 *
 * Event detail DTO (the frontend wire shape), co-located with its model and detail
 * builder.
 */

package events

import "time"

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
