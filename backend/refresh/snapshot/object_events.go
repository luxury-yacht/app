package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	eventres "github.com/luxury-yacht/app/backend/resources/events"
)

const objectEventsDomain = "object-events"

// ObjectEventsBuilder gathers events for a specific object. It reads the owned
// events reflector's store once it has synced, and lists from the API before.
type ObjectEventsBuilder struct {
	client kubernetes.Interface
	events eventStore
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
// poll: the events store the builder reads feeds it (the sink is added here,
// before the reflectors start), and it rings bell. The notifier is nil when
// there is no ingest manager (unit tests; the API-list path has no push
// source, and the poll covers it).
func RegisterObjectEventsDomain(
	reg *domain.Registry,
	client kubernetes.Interface,
	ingestManager *ingest.IngestManager,
	bell doorbell.Bell,
) (*ObjectEventsChangeNotifier, error) {
	if client == nil {
		return nil, fmt.Errorf("kubernetes client is required for object events domain")
	}
	builder := &ObjectEventsBuilder{client: client}
	var notifier *ObjectEventsChangeNotifier
	if ingestManager != nil {
		notifier = NewObjectEventsChangeNotifier(bell)
		if !ingestManager.AddBundleSink(EventGVR, notifier) {
			return nil, fmt.Errorf("%s: events ingest store is unavailable", objectEventsDomain)
		}
		builder.events = ingestManager
	}
	if err := reg.Register(refresh.DomainConfig{
		Name:          objectEventsDomain,
		BuildSnapshot: builder.Build,
	}); err != nil {
		return nil, err
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

	// Prefer the events store once synced; list from the API before then.
	if eventsStoreSynced(b.events) {
		records := storedEventRecords(b.events, func(fact *EventFact) bool {
			return fact.involves(namespace, group, kind, name)
		})
		return buildObjectEventsSnapshot(meta, scope, records, maxEventRecordVersion(records)), nil
	}

	records, version, err := b.listEventsFromAPI(ctx, meta, namespace, group, kind, name)
	if err != nil {
		return nil, err
	}
	return buildObjectEventsSnapshot(meta, scope, records, version), nil
}

func (b *ObjectEventsBuilder) listEventsFromAPI(ctx context.Context, meta ClusterMeta, namespace, group, kind, name string) ([]eventRecord, uint64, error) {
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

	project := newEventRecordProjector(meta.ClusterID)
	records := make([]eventRecord, 0, len(list.Items))
	for i := range list.Items {
		if involvedAPIGroupMatches(list.Items[i].InvolvedObject.APIVersion, group) {
			records = append(records, project(&list.Items[i]))
		}
	}
	version := parseSnapshotResourceVersion(list.ResourceVersion)
	return records, version, nil
}

// involves reports whether the Event is about the object: namespace, kind, and
// name match the way the object's event key does (case-insensitive namespace
// and kind, trimmed), then the group.
func (f *EventFact) involves(namespace, group, kind, name string) bool {
	involvedName := strings.TrimSpace(f.InvolvedName)
	if involvedName == "" || involvedName != strings.TrimSpace(name) {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(f.InvolvedNamespace), strings.TrimSpace(namespace)) ||
		!strings.EqualFold(strings.TrimSpace(f.InvolvedKind), strings.TrimSpace(kind)) {
		return false
	}
	return involvedAPIGroupMatches(f.InvolvedAPIVersion, group)
}

// involvedAPIGroupMatches reports whether an event's involved object belongs
// to the requested API group. An event recorded without an apiVersion cannot
// name a group, so it matches; kind, namespace, and name already did. API
// group names are case-sensitive per RFC 1123.
func involvedAPIGroupMatches(apiVersion, group string) bool {
	apiVersion = strings.TrimSpace(apiVersion)
	if apiVersion == "" {
		return true
	}
	eventGroup, _ := resourcemodel.SplitAPIVersion(apiVersion)
	return eventGroup == group
}

func buildObjectEventsSnapshot(meta ClusterMeta, scope string, records []eventRecord, version uint64) *refresh.Snapshot {
	kept := make([]eventRecord, 0, len(records))
	for _, record := range records {
		if record.fact.InvolvedName != "" {
			kept = append(kept, record)
		}
	}
	// Truncation keeps the most recently observed events.
	sort.SliceStable(kept, func(i, j int) bool { return compareEventRecordOrder(kept[i], kept[j]) < 0 })
	totalItems := len(kept)
	summaries := make([]ObjectEventSummary, 0, min(totalItems, config.SnapshotObjectEventsLimit))
	for _, record := range kept[:min(totalItems, config.SnapshotObjectEventsLimit)] {
		summaries = append(summaries, convertObjectEvent(meta, record))
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

func buildObjectEventIndexKey(namespace, kind, name string) string {
	return strings.ToLower(strings.TrimSpace(namespace)) +
		"|" +
		strings.ToLower(strings.TrimSpace(kind)) +
		"|" +
		strings.TrimSpace(name)
}

// maxEventRecordVersion is the newest resourceVersion among the records, or
// their newest creation time when none has a numeric resourceVersion.
func maxEventRecordVersion(records []eventRecord) uint64 {
	var version uint64
	for _, record := range records {
		if v := eventRecordVersion(record.summary); v > version {
			version = v
		}
	}
	return version
}

func eventRecordVersion(summary objectcatalog.Summary) uint64 {
	if parsed, err := strconv.ParseUint(summary.ResourceVersion, 10, 64); err == nil {
		return parsed
	}
	created, err := time.Parse(time.RFC3339, summary.CreationTimestamp)
	if err != nil {
		return 0
	}
	return uint64(created.UnixNano())
}

func convertObjectEvent(meta ClusterMeta, record eventRecord) ObjectEventSummary {
	fact := record.fact
	return ObjectEventSummary{
		Ref:                     record.summary.Ref,
		Metadata:                record.summary.Metadata,
		ResourceVersion:         record.summary.ResourceVersion,
		EventType:               fact.Type,
		Reason:                  strings.TrimSpace(fact.Reason),
		Message:                 strings.TrimSpace(fact.Message),
		Count:                   fact.Count,
		FirstTimestamp:          timeFromUnixNanos(fact.FirstObserved),
		LastTimestamp:           timeFromUnixNanos(fact.LastObserved),
		Source:                  fact.Source,
		InvolvedObjectName:      fact.InvolvedName,
		InvolvedObjectKind:      fact.InvolvedKind,
		InvolvedObjectNamespace: fact.InvolvedNamespace,
		InvolvedObjectUID:       fact.InvolvedUID,
		InvolvedObject:          eventres.ObjectLink(meta.ClusterID, fact.involvedObject()),
	}
}
