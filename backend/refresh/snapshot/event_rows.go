package snapshot

import (
	"strings"

	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	eventres "github.com/luxury-yacht/app/backend/resources/events"
)

// EventSummary is one Kubernetes Event as an Events table row. Ref identifies
// the Event itself; the Object* fields describe the object it is about. Display
// fields carry the Event's own values, empty when the Event leaves them empty,
// so every surface renders one placeholder for them.
type EventSummary struct {
	Ref             resourcemodel.ResourceRef            `json:"ref"`
	Metadata        *resourcemodel.ResourceTableMetadata `json:"metadata,omitempty"`
	ResourceVersion string                               `json:"resourceVersion"`
	ObjectKind      string                               `json:"objectKind"`
	ObjectName      string                               `json:"objectName"`
	ObjectNamespace string                               `json:"objectNamespace"`
	ObjectUID       string                               `json:"objectUid"`
	InvolvedObject  *resourcemodel.ResourceLink          `json:"involvedObject,omitempty"`
	Type            string                               `json:"type"`
	Source          string                               `json:"source"`
	Reason          string                               `json:"reason"`
	Object          string                               `json:"object"`
	Message         string                               `json:"message"`
	Age             string                               `json:"age"`
	AgeTimestamp    int64                                `json:"ageTimestamp"`
}

// projectEventRow is the single projection of an Event into an Events table
// row, shared by the Cluster and Namespace Events tables.
func projectEventRow(meta ClusterMeta, event *corev1.Event) EventSummary {
	facts := eventres.BuildFacts(meta.ClusterID, event)
	timestamp := eventres.EventTimestamp(event).Time
	return EventSummary{
		Ref:             streamrows.NewResourceRef(meta, eventres.Identity, event),
		Metadata:        streamrows.NewResourceMetadata(event),
		ResourceVersion: event.ResourceVersion,
		ObjectKind:      strings.TrimSpace(event.InvolvedObject.Kind),
		ObjectName:      strings.TrimSpace(event.InvolvedObject.Name),
		ObjectNamespace: event.InvolvedObject.Namespace,
		ObjectUID:       string(event.InvolvedObject.UID),
		InvolvedObject:  facts.InvolvedObject,
		Type:            facts.EventType,
		Source:          facts.Source,
		Reason:          facts.Reason,
		Object:          eventres.EventObjectDisplay(event),
		Message:         facts.Message,
		Age:             formatAge(timestamp),
		AgeTimestamp:    timestamp.UnixMilli(),
	}
}
