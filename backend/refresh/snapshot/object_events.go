package snapshot

import (
	"context"
	"fmt"
	"sort"
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

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	eventres "github.com/luxury-yacht/app/backend/resources/events"
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
	Ref                     resourcemodel.ResourceRef            `json:"ref"`
	Metadata                *resourcemodel.ResourceTableMetadata `json:"metadata,omitempty"`
	ResourceVersion         string                               `json:"resourceVersion"`
	EventType               string                               `json:"eventType"`
	Reason                  string                               `json:"reason"`
	Message                 string                               `json:"message"`
	Count                   int32                                `json:"count"`
	FirstTimestamp          time.Time                            `json:"firstTimestamp"`
	LastTimestamp           time.Time                            `json:"lastTimestamp"`
	Source                  string                               `json:"source"`
	InvolvedObjectName      string                               `json:"involvedObjectName"`
	InvolvedObjectKind      string                               `json:"involvedObjectKind"`
	InvolvedObjectNamespace string                               `json:"involvedObjectNamespace"`
	InvolvedObjectUID       string                               `json:"involvedObjectUid"`
	InvolvedObject          *resourcemodel.ResourceLink          `json:"involvedObject,omitempty"`
}

// ObjectEventsSnapshotPayload contains the events list for the object.
type ObjectEventsSnapshotPayload struct {
	ClusterMeta
	Events []ObjectEventSummary `json:"events"`
}

// RegisterObjectEventsDomain registers the object-events domain.
//
// It returns the change notifier that replaces the Object Panel Events tab's
// poll: the SAME shared events informer the builder reads feeds it (handler
// registered HERE, before the informer factory starts), and the subsystem
// wires its broadcast to the resource-stream doorbell once the stream manager
// exists. The notifier is nil when no informer factory is available (the
// API-list fallback path has no push source; the poll covers it).
func RegisterObjectEventsDomain(
	reg *domain.Registry,
	client kubernetes.Interface,
	factory informers.SharedInformerFactory,
) (*ObjectEventsChangeNotifier, error) {
	if client == nil {
		return nil, fmt.Errorf("kubernetes client is required for object events domain")
	}
	builder := &ObjectEventsBuilder{client: client}
	notifier, err := configureObjectEventsInformer(factory, builder)
	if err != nil {
		return nil, err
	}
	if err := reg.Register(refresh.DomainConfig{
		Name:          objectEventsDomain,
		BuildSnapshot: builder.Build,
	}); err != nil {
		return nil, err
	}
	return notifier, nil
}

func configureObjectEventsInformer(factory informers.SharedInformerFactory, builder *ObjectEventsBuilder) (*ObjectEventsChangeNotifier, error) {
	if factory == nil {
		return nil, nil
	}
	eventInformer := factory.Core().V1().Events()
	if eventInformer == nil {
		return nil, nil
	}
	_ = eventInformer.Informer().AddIndexers(cache.Indexers{
		objectEventIndexName: objectEventIndex,
	})
	builder.eventLister = eventInformer.Lister()
	builder.eventIndexer = eventInformer.Informer().GetIndexer()
	builder.eventSynced = eventInformer.Informer().HasSynced

	notifier := NewObjectEventsChangeNotifier()
	record := func(obj interface{}) {
		if evt, ok := maintainedUnwrap(obj).(*corev1.Event); ok {
			notifier.EventChanged(evt)
		}
	}
	_, err := eventInformer.Informer().AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: record,
		UpdateFunc: func(oldObj, newObj interface{}) {
			// Informer resyncs re-deliver every event with an unchanged
			// ResourceVersion; only real changes ring the doorbell.
			if informerUpdateIsEcho(oldObj, newObj) {
				return
			}
			record(newObj)
		},
		DeleteFunc: record,
	})
	if err != nil {
		return nil, fmt.Errorf("object-events: register event handler: %w", err)
	}
	return notifier, nil
}

func (b *ObjectEventsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	identity, err := refresh.ParseObjectScope(scope)
	if err != nil {
		return nil, err
	}
	namespace := identity.Namespace
	kind := identity.GVK.Kind
	name := identity.Name
	// ParseObjectScope requires GVK-form scopes, so two CRDs sharing a Kind get
	// distinct event lists by group. The version is not compared: an object
	// exists once per group, and controllers record events against whichever
	// served version they use.
	group := identity.GVK.Group
	meta := ClusterMetaFromContext(ctx)

	// Prefer informer cache once synced; fall back to API list to preserve pre-sync/error behavior.
	if b.eventLister != nil && b.eventSynced != nil && b.eventSynced() {
		events, version, cacheErr := b.listEventsFromCache(namespace, group, kind, name)
		if cacheErr == nil {
			return b.buildSnapshot(meta, scope, events, version), nil
		}
	}

	events, version, err := b.listEventsFromAPI(ctx, namespace, group, kind, name)
	if err != nil {
		return nil, err
	}

	return b.buildSnapshot(meta, scope, events, version), nil
}

func (b *ObjectEventsBuilder) listEventsFromCache(namespace, group, kind, name string) ([]*corev1.Event, uint64, error) {
	if b.eventLister == nil {
		return nil, 0, fmt.Errorf("event cache not configured")
	}
	events, err := b.listEventsByIndex(namespace, group, kind, name)
	if err != nil {
		return nil, 0, err
	}
	if events == nil {
		events, err = b.listEventsByScan(namespace, group, kind, name)
		if err != nil {
			return nil, 0, err
		}
	}
	version := maxEventVersion(events)
	return events, version, nil
}

func (b *ObjectEventsBuilder) listEventsFromAPI(ctx context.Context, namespace, group, kind, name string) ([]*corev1.Event, uint64, error) {
	selectors := []fields.Selector{
		fields.OneTermEqualSelector("involvedObject.name", name),
	}
	if strings.TrimSpace(kind) != "" {
		selectors = append(selectors, fields.OneTermEqualSelector("involvedObject.kind", kind))
	}
	if namespace != "" {
		selectors = append(selectors, fields.OneTermEqualSelector("involvedObject.namespace", namespace))
	}
	// A field selector cannot match a group across versions, so two CRDs
	// sharing a Kind+namespace+name are told apart after the list.
	fieldSelector := fields.AndSelectors(selectors...).String()

	list, err := b.client.CoreV1().Events(namespace).List(
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
		if involvedObjectMatchesGroup(&list.Items[i], group) {
			events = append(events, &list.Items[i])
		}
	}
	version := parseSnapshotResourceVersion(list.ResourceVersion)
	return events, version, nil
}

func (b *ObjectEventsBuilder) listEventsByIndex(namespace, group, kind, name string) ([]*corev1.Event, error) {
	if b.eventIndexer == nil {
		return nil, nil
	}
	if _, ok := b.eventIndexer.GetIndexers()[objectEventIndexName]; !ok {
		return nil, nil
	}
	// The index is keyed by namespace|kind|name (group-agnostic). The group
	// post-filter drops events for sibling CRDs that share kind/name in the
	// same namespace.
	key := buildObjectEventIndexKey(namespace, kind, name)
	items, err := b.eventIndexer.ByIndex(objectEventIndexName, key)
	if err != nil {
		return nil, err
	}
	events := make([]*corev1.Event, 0, len(items))
	for _, item := range items {
		evt, ok := item.(*corev1.Event)
		if !ok || evt == nil {
			continue
		}
		if !involvedObjectMatchesGroup(evt, group) {
			continue
		}
		events = append(events, evt)
	}
	return events, nil
}

func (b *ObjectEventsBuilder) listEventsByScan(namespace, group, kind, name string) ([]*corev1.Event, error) {
	events, err := b.eventLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	filtered := make([]*corev1.Event, 0, len(events))
	for _, evt := range events {
		if eventInvolvesObject(evt, namespace, group, kind, name) {
			filtered = append(filtered, evt)
		}
	}
	return filtered, nil
}

// eventInvolvesObject applies the index's namespace|kind|name match plus the
// group post-filter to one event, for the cache-scan path.
func eventInvolvesObject(evt *corev1.Event, namespace, group, kind, name string) bool {
	if evt == nil || evt.InvolvedObject.Name == "" || evt.InvolvedObject.Name != name {
		return false
	}
	if namespace != "" && evt.InvolvedObject.Namespace != namespace {
		return false
	}
	if kind != "" && !strings.EqualFold(evt.InvolvedObject.Kind, kind) {
		return false
	}
	return involvedObjectMatchesGroup(evt, group)
}

// involvedObjectMatchesGroup reports whether the event's involved object
// belongs to the requested API group. An event recorded without an apiVersion
// cannot name a group, so it matches; kind, namespace, and name already did.
// API group names are case-sensitive per RFC 1123.
func involvedObjectMatchesGroup(evt *corev1.Event, group string) bool {
	apiVersion := strings.TrimSpace(evt.InvolvedObject.APIVersion)
	if apiVersion == "" {
		return true
	}
	eventGroup, _ := resourcemodel.SplitAPIVersion(apiVersion)
	return eventGroup == group
}

func (b *ObjectEventsBuilder) buildSnapshot(meta ClusterMeta, scope string, events []*corev1.Event, version uint64) *refresh.Snapshot {
	kept := make([]*corev1.Event, 0, len(events))
	for _, evt := range events {
		if evt != nil && evt.InvolvedObject.Name != "" {
			kept = append(kept, evt)
		}
	}
	// Truncation keeps the most recently observed events.
	sort.SliceStable(kept, func(i, j int) bool { return compareEventOrder(kept[i], kept[j]) < 0 })
	totalItems := len(kept)
	summaries := make([]ObjectEventSummary, 0, min(totalItems, config.SnapshotObjectEventsLimit))
	for _, evt := range kept[:min(totalItems, config.SnapshotObjectEventsLimit)] {
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
	facts := eventres.BuildFacts(meta.ClusterID, &evt)

	return ObjectEventSummary{
		Ref:                     streamrows.NewResourceRef(meta, eventres.Identity, &evt),
		Metadata:                streamrows.NewResourceMetadata(&evt),
		ResourceVersion:         evt.ResourceVersion,
		EventType:               facts.EventType,
		Reason:                  facts.Reason,
		Message:                 facts.Message,
		Count:                   facts.Count,
		FirstTimestamp:          facts.FirstTimestamp.Time,
		LastTimestamp:           facts.LastTimestamp.Time,
		Source:                  facts.Source,
		InvolvedObjectName:      evt.InvolvedObject.Name,
		InvolvedObjectKind:      evt.InvolvedObject.Kind,
		InvolvedObjectNamespace: evt.InvolvedObject.Namespace,
		InvolvedObjectUID:       string(evt.InvolvedObject.UID),
		InvolvedObject:          facts.InvolvedObject,
	}
}
