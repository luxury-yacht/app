package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	clusterEventsDomainName = "cluster-events"
)

// ClusterEventsBuilder aggregates Kubernetes Events for the cluster tab.
type ClusterEventsBuilder struct {
	eventLister corelisters.EventLister
}

// ClusterEventsSnapshot is the payload returned to the UI.
type ClusterEventsSnapshot struct {
	ClusterMeta
	Events []ClusterEventEntry `json:"events"`
}

// ClusterEventEntry mirrors the fields consumed by the frontend grid.
type ClusterEventEntry struct {
	ClusterMeta
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	ObjectNamespace string `json:"objectNamespace"`
	Type            string `json:"type"`
	Source          string `json:"source"`
	Reason          string `json:"reason"`
	Object          string `json:"object"`
	Message         string `json:"message"`
	Age             string `json:"age"`
}

// RegisterClusterEventsDomain registers the cluster events domain.
func RegisterClusterEventsDomain(reg *domain.Registry, factory informers.SharedInformerFactory) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &ClusterEventsBuilder{
		eventLister: factory.Core().V1().Events().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          clusterEventsDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build gathers recent cluster events.
func (b *ClusterEventsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	events, err := b.eventLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	sort.Slice(events, func(i, j int) bool {
		ti := eventTimestamp(events[i])
		tj := eventTimestamp(events[j])
		return ti.After(tj)
	})

	originalCount := len(events)
	if originalCount > clusterEventsLimit {
		events = events[:clusterEventsLimit]
	}

	entries := make([]ClusterEventEntry, 0, len(events))
	var version uint64
	for _, evt := range events {
		if evt == nil {
			continue
		}
		timestamp := eventTimestamp(evt)
		objectNamespace := evt.InvolvedObject.Namespace
		entries = append(entries, ClusterEventEntry{
			ClusterMeta: meta,
			Kind:            "Event",
			Name:            evt.Name,
			Namespace:       objectNamespace,
			ObjectNamespace: objectNamespace,
			Type:            eventSeverity(evt),
			Source:          eventSource(evt),
			Reason:          evt.Reason,
			Object:          eventObject(evt),
			Message:         eventMessage(evt),
			Age:             formatAge(timestamp),
		})
		if v := resourceVersionOrTimestamp(evt); v > version {
			version = v
		}
	}

	stats := refresh.SnapshotStats{
		ItemCount: len(entries),
	}
	if originalCount > len(entries) {
		stats.Truncated = true
		stats.TotalItems = originalCount
		stats.Warnings = []string{fmt.Sprintf("Showing most recent %d of %d events", len(entries), originalCount)}
	}

	return &refresh.Snapshot{
		Domain:  clusterEventsDomainName,
		Version: version,
		Payload: ClusterEventsSnapshot{ClusterMeta: meta, Events: entries},
		Stats:   stats,
	}, nil
}

func eventTimestamp(evt *corev1.Event) time.Time {
	if evt == nil {
		return time.Time{}
	}
	if !evt.EventTime.IsZero() {
		return evt.EventTime.Time
	}
	if !evt.LastTimestamp.IsZero() {
		return evt.LastTimestamp.Time
	}
	if !evt.FirstTimestamp.IsZero() {
		return evt.FirstTimestamp.Time
	}
	return evt.CreationTimestamp.Time
}

func eventSeverity(evt *corev1.Event) string {
	if evt == nil || evt.Type == "" {
		return "-"
	}
	return evt.Type
}

func eventSource(evt *corev1.Event) string {
	if evt == nil {
		return "-"
	}
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
	return "-"
}

func eventObject(evt *corev1.Event) string {
	if evt == nil {
		return "-"
	}
	kind := strings.TrimSpace(evt.InvolvedObject.Kind)
	name := strings.TrimSpace(evt.InvolvedObject.Name)
	if kind != "" && name != "" {
		return fmt.Sprintf("%s/%s", kind, name)
	}
	if name != "" {
		return name
	}
	if kind != "" {
		return kind
	}
	return "-"
}

func eventMessage(evt *corev1.Event) string {
	if evt == nil {
		return ""
	}
	if msg := strings.TrimSpace(evt.Message); msg != "" {
		return msg
	}
	return strings.TrimSpace(evt.Reason)
}
