package snapshot

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const objectEventsDomain = "object-events"

// ObjectEventsBuilder gathers events for a specific object.
type ObjectEventsBuilder struct {
	client kubernetes.Interface
}

// ObjectEventSummary captures the fields the frontend needs for object events.
type ObjectEventSummary struct {
	ClusterMeta
	Kind                    string    `json:"kind"`
	EventType               string    `json:"eventType"`
	Reason                  string    `json:"reason"`
	Message                 string    `json:"message"`
	Count                   int32     `json:"count"`
	FirstTimestamp          time.Time `json:"firstTimestamp"`
	LastTimestamp           time.Time `json:"lastTimestamp"`
	Source                  string    `json:"source"`
	InvolvedObjectName      string    `json:"involvedObjectName"`
	InvolvedObjectKind      string    `json:"involvedObjectKind"`
	InvolvedObjectNamespace string    `json:"involvedObjectNamespace"`
	Namespace               string    `json:"namespace"`
}

// ObjectEventsSnapshotPayload contains the events list for the object.
type ObjectEventsSnapshotPayload struct {
	ClusterMeta
	Events []ObjectEventSummary `json:"events"`
}

// RegisterObjectEventsDomain registers the object-events domain.
func RegisterObjectEventsDomain(reg *domain.Registry, client kubernetes.Interface) error {
	if client == nil {
		return fmt.Errorf("kubernetes client is required for object events domain")
	}
	builder := &ObjectEventsBuilder{client: client}
	return reg.Register(refresh.DomainConfig{
		Name:          objectEventsDomain,
		BuildSnapshot: builder.Build,
	})
}

func (b *ObjectEventsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	namespace, kind, name, err := parseObjectScope(scope)
	if err != nil {
		return nil, err
	}
	meta := CurrentClusterMeta()

	eventNamespace := namespace
	if namespace == "" {
		eventNamespace = metav1.NamespaceAll
	}

	selectors := []fields.Selector{
		fields.OneTermEqualSelector("involvedObject.name", name),
	}
	if namespace != "" {
		selectors = append(selectors, fields.OneTermEqualSelector("involvedObject.namespace", namespace))
	}

	fieldSelector := fields.AndSelectors(selectors...).String()

	list, err := b.client.CoreV1().Events(eventNamespace).List(
		ctx,
		metav1.ListOptions{
			FieldSelector: fieldSelector,
		},
	)
	if err != nil {
		return nil, err
	}

	totalItems := len(list.Items)

	events := make([]ObjectEventSummary, 0, min(totalItems, objectEventsLimit))
	for _, evt := range list.Items {
		if len(events) >= objectEventsLimit {
			break
		}
		if evt.InvolvedObject.Name == "" {
			continue
		}
		if kind != "" && !strings.EqualFold(evt.InvolvedObject.Kind, kind) {
			continue
		}
		events = append(events, convertObjectEvent(meta, evt))
	}

	payload := ObjectEventsSnapshotPayload{ClusterMeta: meta, Events: events}

	version := parseEventVersion(list.ResourceVersion)

	stats := refresh.SnapshotStats{
		ItemCount: len(events),
	}
	if totalItems > len(events) {
		stats.Truncated = true
		stats.TotalItems = totalItems
		stats.Warnings = []string{fmt.Sprintf("Showing most recent %d of %d events", len(events), totalItems)}
	}

	snapshot := &refresh.Snapshot{
		Domain:  objectEventsDomain,
		Scope:   scope,
		Version: version,
		Payload: payload,
		Stats:   stats,
	}
	return snapshot, nil
}

func parseEventVersion(rv string) uint64 {
	if rv == "" {
		return 0
	}
	if v, err := strconv.ParseUint(rv, 10, 64); err == nil {
		return v
	}
	return 0
}

func convertObjectEvent(meta ClusterMeta, evt corev1.Event) ObjectEventSummary {
	first := evt.EventTime.Time
	last := evt.EventTime.Time
	if first.IsZero() {
		first = evt.FirstTimestamp.Time
	}
	if last.IsZero() {
		last = evt.LastTimestamp.Time
	}

	source := formatObjectEventSource(evt)

	return ObjectEventSummary{
		ClusterMeta:            meta,
		Kind:                    "event",
		EventType:               evt.Type,
		Reason:                  evt.Reason,
		Message:                 evt.Message,
		Count:                   evt.Count,
		FirstTimestamp:          first,
		LastTimestamp:           last,
		Source:                  source,
		InvolvedObjectName:      evt.InvolvedObject.Name,
		InvolvedObjectKind:      evt.InvolvedObject.Kind,
		InvolvedObjectNamespace: evt.InvolvedObject.Namespace,
		Namespace:               evt.Namespace,
	}
}

func formatObjectEventSource(evt corev1.Event) string {
	if evt.Source.Component != "" {
		if evt.Source.Host != "" {
			return fmt.Sprintf("%s on %s", evt.Source.Component, evt.Source.Host)
		}
		return evt.Source.Component
	}
	if evt.ReportingController != "" {
		if evt.ReportingInstance != "" {
			return fmt.Sprintf("%s (%s)", evt.ReportingController, evt.ReportingInstance)
		}
		return evt.ReportingController
	}
	return "Unknown"
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
