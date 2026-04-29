package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const namespaceEventsDomainName = "namespace-events"

// NamespaceEventsBuilder constructs summaries for namespace scoped events.
type NamespaceEventsBuilder struct {
	eventLister corelisters.EventLister
}

// NamespaceEventsSnapshot payload for events tab.
type NamespaceEventsSnapshot struct {
	ClusterMeta
	Events []EventSummary `json:"events"`
}

// EventSummary captures the essential event fields for display.
type EventSummary struct {
	ClusterMeta
	Kind             string `json:"kind"`
	Name             string `json:"name"`
	UID              string `json:"uid"`
	ResourceVersion  string `json:"resourceVersion"`
	Namespace        string `json:"namespace"`
	ObjectNamespace  string `json:"objectNamespace"`
	ObjectUID        string `json:"objectUid"`
	ObjectAPIVersion string `json:"objectApiVersion"`
	Type             string `json:"type"`
	Source           string `json:"source"`
	Reason           string `json:"reason"`
	Object           string `json:"object"`
	Message          string `json:"message"`
	Age              string `json:"age"`
	AgeTimestamp     int64  `json:"ageTimestamp"`
}

// RegisterNamespaceEventsDomain registers the events domain.
func RegisterNamespaceEventsDomain(reg *domain.Registry, factory informers.SharedInformerFactory) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceEventsBuilder{
		eventLister: factory.Core().V1().Events().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceEventsDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles event summaries for a namespace.
func (b *NamespaceEventsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	_ = ctx
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, fmt.Errorf("namespace scope is required")
	}

	isAll := isAllNamespaceScope(trimmed)
	var namespace string
	if !isAll {
		namespace = normalizeNamespaceScope(trimmed)
		if namespace == "" {
			return nil, fmt.Errorf("namespace scope is required")
		}
	}

	var (
		events []*corev1.Event
		err    error
	)
	if isAll {
		events, err = b.eventLister.List(labels.Everything())
		if err != nil {
			return nil, err
		}
	} else {
		events, err = b.eventLister.Events(namespace).List(labels.Everything())
		if err != nil {
			return nil, err
		}
	}

	filtered := make([]*corev1.Event, 0, len(events))
	for _, event := range events {
		if event == nil {
			continue
		}
		eventNamespace := strings.TrimSpace(event.InvolvedObject.Namespace)
		if eventNamespace == "" {
			continue
		}
		if !isAll && eventNamespace != namespace {
			continue
		}
		filtered = append(filtered, event)
	}
	events = filtered

	sort.Slice(events, func(i, j int) bool {
		return compareEventOrder(events[i], events[j]) < 0
	})

	originalCount := len(events)
	if originalCount > config.SnapshotNamespaceEventsLimit {
		events = events[:config.SnapshotNamespaceEventsLimit]
	}

	summaries := make([]EventSummary, 0, len(events))
	var version uint64

	scopeValue := namespace
	if isAll {
		scopeValue = "namespace:all"
	}
	scopeValue = refresh.JoinClusterScope(clusterID, scopeValue)

	for _, event := range events {
		if event == nil {
			continue
		}
		if event.InvolvedObject.Namespace == "" {
			continue
		}
		timestamp := eventTimestamp(event)
		summary := EventSummary{
			ClusterMeta:      meta,
			Kind:             event.InvolvedObject.Kind,
			Name:             event.Name,
			UID:              string(event.UID),
			ResourceVersion:  event.ResourceVersion,
			Namespace:        event.InvolvedObject.Namespace,
			ObjectNamespace:  event.InvolvedObject.Namespace,
			ObjectUID:        string(event.InvolvedObject.UID),
			ObjectAPIVersion: event.InvolvedObject.APIVersion,
			Type:             event.Type,
			Source:           namespaceEventSource(event),
			Reason:           event.Reason,
			Object:           namespaceInvolvedObject(event),
			Message:          event.Message,
			Age:              formatAge(timestamp),
			AgeTimestamp:     timestamp.UnixMilli(),
		}
		summaries = append(summaries, summary)
		if v := resourceVersionOrTimestamp(event); v > version {
			version = v
		}
	}

	stats := refresh.SnapshotStats{
		ItemCount: len(summaries),
	}
	if originalCount > len(summaries) {
		stats.Truncated = true
		stats.TotalItems = originalCount
		stats.Warnings = []string{fmt.Sprintf("Showing most recent %d of %d events", len(summaries), originalCount)}
	}

	return &refresh.Snapshot{
		Domain:  namespaceEventsDomainName,
		Scope:   scopeValue,
		Version: version,
		Payload: NamespaceEventsSnapshot{ClusterMeta: meta, Events: summaries},
		Stats:   stats,
	}, nil
}

func namespaceEventSource(event *corev1.Event) string {
	if event == nil {
		return ""
	}
	source := event.Source.Component
	if event.Source.Host != "" {
		source = fmt.Sprintf("%s/%s", source, event.Source.Host)
	}
	return source
}

func namespaceInvolvedObject(event *corev1.Event) string {
	if event == nil {
		return ""
	}
	obj := event.InvolvedObject
	if obj.Name == "" {
		return obj.Kind
	}
	return fmt.Sprintf("%s/%s", obj.Kind, obj.Name)
}
