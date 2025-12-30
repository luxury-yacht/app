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
		iTime := events[i].CreationTimestamp.Time
		jTime := events[j].CreationTimestamp.Time
		return iTime.After(jTime)
	})

	originalCount := len(events)
	if originalCount > namespaceEventsLimit {
		events = events[:namespaceEventsLimit]
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
		summary := EventSummary{
			ClusterMeta:    meta,
			Kind:            event.InvolvedObject.Kind,
			Name:            event.Name,
			Namespace:       event.InvolvedObject.Namespace,
			ObjectNamespace: event.InvolvedObject.Namespace,
			Type:            event.Type,
			Source:          namespaceEventSource(event),
			Reason:          event.Reason,
			Object:          namespaceInvolvedObject(event),
			Message:         event.Message,
			Age:             formatAge(event.CreationTimestamp.Time),
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
