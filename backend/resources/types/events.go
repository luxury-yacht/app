package types

import "time"

// Event represents a Kubernetes event with simplified fields for the UI.
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
