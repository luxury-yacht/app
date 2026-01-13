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
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const objectEventsDomain = "object-events"
const objectEventIndexName = "events:object"

// ObjectEventsBuilder gathers events for a specific object.
type ObjectEventsBuilder struct {
	client       kubernetes.Interface
	eventLister  corelisters.EventLister
	eventIndexer cache.Indexer
	eventSynced  cache.InformerSynced
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
func RegisterObjectEventsDomain(
	reg *domain.Registry,
	client kubernetes.Interface,
	factory informers.SharedInformerFactory,
) error {
	if client == nil {
		return fmt.Errorf("kubernetes client is required for object events domain")
	}
	builder := &ObjectEventsBuilder{client: client}
	if factory != nil {
		eventInformer := factory.Core().V1().Events()
		if eventInformer != nil {
			_ = eventInformer.Informer().AddIndexers(cache.Indexers{
				objectEventIndexName: objectEventIndex,
			})
			builder.eventLister = eventInformer.Lister()
			builder.eventIndexer = eventInformer.Informer().GetIndexer()
			builder.eventSynced = eventInformer.Informer().HasSynced
		}
	}
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
	meta := ClusterMetaFromContext(ctx)

	// Prefer informer cache once synced; fall back to API list to preserve pre-sync/error behavior.
	if b.eventLister != nil && b.eventSynced != nil && b.eventSynced() {
		events, version, cacheErr := b.listEventsFromCache(namespace, kind, name)
		if cacheErr == nil {
			return b.buildSnapshot(meta, scope, events, version), nil
		}
	}

	events, version, err := b.listEventsFromAPI(ctx, namespace, kind, name)
	if err != nil {
		return nil, err
	}

	return b.buildSnapshot(meta, scope, events, version), nil
}

func (b *ObjectEventsBuilder) listEventsFromCache(namespace, kind, name string) ([]*corev1.Event, uint64, error) {
	if b.eventLister == nil {
		return nil, 0, fmt.Errorf("event cache not configured")
	}
	events, err := b.listEventsByIndex(namespace, kind, name)
	if err != nil {
		return nil, 0, err
	}
	if events == nil {
		events, err = b.listEventsByScan(namespace, kind, name)
		if err != nil {
			return nil, 0, err
		}
	}
	version := maxEventVersion(events)
	return events, version, nil
}

func (b *ObjectEventsBuilder) listEventsFromAPI(ctx context.Context, namespace, kind, name string) ([]*corev1.Event, uint64, error) {
	eventNamespace := namespace
	if namespace == "" {
		eventNamespace = metav1.NamespaceAll
	}
	selectors := []fields.Selector{
		fields.OneTermEqualSelector("involvedObject.name", name),
	}
	if strings.TrimSpace(kind) != "" {
		selectors = append(selectors, fields.OneTermEqualSelector("involvedObject.kind", kind))
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
		return nil, 0, err
	}

	events := make([]*corev1.Event, 0, len(list.Items))
	for i := range list.Items {
		events = append(events, &list.Items[i])
	}
	version := parseEventVersion(list.ResourceVersion)
	return events, version, nil
}

func (b *ObjectEventsBuilder) listEventsByIndex(namespace, kind, name string) ([]*corev1.Event, error) {
	if b.eventIndexer == nil {
		return nil, nil
	}
	if _, ok := b.eventIndexer.GetIndexers()[objectEventIndexName]; !ok {
		return nil, nil
	}
	key := buildObjectEventIndexKey(namespace, kind, name)
	items, err := b.eventIndexer.ByIndex(objectEventIndexName, key)
	if err != nil {
		return nil, err
	}
	events := make([]*corev1.Event, 0, len(items))
	for _, item := range items {
		if evt, ok := item.(*corev1.Event); ok && evt != nil {
			events = append(events, evt)
		}
	}
	return events, nil
}

func (b *ObjectEventsBuilder) listEventsByScan(namespace, kind, name string) ([]*corev1.Event, error) {
	events, err := b.eventLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	filtered := make([]*corev1.Event, 0, len(events))
	for _, evt := range events {
		if evt == nil || evt.InvolvedObject.Name == "" {
			continue
		}
		if evt.InvolvedObject.Name != name {
			continue
		}
		if namespace != "" && evt.InvolvedObject.Namespace != namespace {
			continue
		}
		if kind != "" && !strings.EqualFold(evt.InvolvedObject.Kind, kind) {
			continue
		}
		filtered = append(filtered, evt)
	}
	return filtered, nil
}

func (b *ObjectEventsBuilder) buildSnapshot(meta ClusterMeta, scope string, events []*corev1.Event, version uint64) *refresh.Snapshot {
	totalItems := len(events)
	summaries := make([]ObjectEventSummary, 0, min(totalItems, objectEventsLimit))
	for _, evt := range events {
		if len(summaries) >= objectEventsLimit {
			break
		}
		if evt == nil || evt.InvolvedObject.Name == "" {
			continue
		}
		summaries = append(summaries, convertObjectEvent(meta, *evt))
	}

	payload := ObjectEventsSnapshotPayload{ClusterMeta: meta, Events: summaries}

	stats := refresh.SnapshotStats{
		ItemCount: len(summaries),
	}
	if totalItems > len(summaries) {
		stats.Truncated = true
		stats.TotalItems = totalItems
		stats.Warnings = []string{fmt.Sprintf("Showing most recent %d of %d events", len(summaries), totalItems)}
	}

	return &refresh.Snapshot{
		Domain:  objectEventsDomain,
		Scope:   scope,
		Version: version,
		Payload: payload,
		Stats:   stats,
	}
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

func objectEventIndex(obj interface{}) ([]string, error) {
	evt, ok := obj.(*corev1.Event)
	if !ok || evt == nil {
		return nil, nil
	}
	name := strings.TrimSpace(evt.InvolvedObject.Name)
	if name == "" {
		return nil, nil
	}
	key := buildObjectEventIndexKey(evt.InvolvedObject.Namespace, evt.InvolvedObject.Kind, name)
	return []string{key}, nil
}

func buildObjectEventIndexKey(namespace, kind, name string) string {
	return strings.ToLower(strings.TrimSpace(namespace)) +
		"|" +
		strings.ToLower(strings.TrimSpace(kind)) +
		"|" +
		strings.TrimSpace(name)
}

func maxEventVersion(events []*corev1.Event) uint64 {
	var version uint64
	for _, evt := range events {
		if evt == nil {
			continue
		}
		if v := resourceVersionOrTimestamp(evt); v > version {
			version = v
		}
	}
	return version
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
		ClusterMeta:             meta,
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
