// Events intake. The owned events reflector projects each Event into the
// Events table row (handed to the table sinks at intake, never stored), its
// catalog Summary, and a slim fact. Object events, Attention, the namespace
// warning rollup, and Recent Events read the Summary and the fact back at
// serve; nothing keeps the Event itself.
package snapshot

import (
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	eventres "github.com/luxury-yacht/app/backend/resources/events"
)

// EventGVR / EventGVK key the owned events reflector.
var (
	EventGVR = eventres.Identity.GVR()
	EventGVK = schema.GroupVersionKind{Group: eventres.Identity.Group, Version: eventres.Identity.Version, Kind: eventres.Identity.Kind}
)

// EventFact is the slim part of a stored Event: what its readers show that
// the catalog Summary does not carry. The involved object, Reason, and Message
// are kept as the Event has them; each reader trims as it always has. Times
// are Unix nanoseconds, 0 for none.
type EventFact struct {
	InvolvedAPIVersion string
	InvolvedKind       string
	InvolvedName       string
	InvolvedNamespace  string
	InvolvedUID        string
	Type               string
	Reason             string
	Message            string
	Source             string
	Count              int32
	FirstObserved      int64
	LastObserved       int64
}

func newEventFact(event *corev1.Event) *EventFact {
	first, last := eventres.EventTimes(event)
	return &EventFact{
		InvolvedAPIVersion: event.InvolvedObject.APIVersion,
		InvolvedKind:       event.InvolvedObject.Kind,
		InvolvedName:       event.InvolvedObject.Name,
		InvolvedNamespace:  event.InvolvedObject.Namespace,
		InvolvedUID:        string(event.InvolvedObject.UID),
		Type:               event.Type,
		Reason:             event.Reason,
		Message:            event.Message,
		Source:             eventres.FormatEventSource(*event, ""),
		Count:              event.Count,
		FirstObserved:      unixNanos(first.Time),
		LastObserved:       unixNanos(last.Time),
	}
}

func unixNanos(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixNano()
}

// timeFromUnixNanos rebuilds a stored time in UTC, so its JSON does not depend
// on the machine's time zone.
func timeFromUnixNanos(nanos int64) time.Time {
	if nanos == 0 {
		return time.Time{}
	}
	return time.Unix(0, nanos).UTC()
}

func (f *EventFact) lastObserved() time.Time { return timeFromUnixNanos(f.LastObserved) }

func (f *EventFact) involvedObject() corev1.ObjectReference {
	return corev1.ObjectReference{
		APIVersion: f.InvolvedAPIVersion, Kind: f.InvolvedKind, Namespace: f.InvolvedNamespace,
		Name: f.InvolvedName, UID: types.UID(f.InvolvedUID),
	}
}

// NewEventIngestProjector returns the ProjectFunc for the owned events
// reflector: the Events table row as the Table half, the catalog Summary, and
// the slim fact as the Aggregate half.
func NewEventIngestProjector(meta ClusterMeta) ingest.ProjectFunc {
	record := newEventRecordProjector(meta.ClusterID)
	return func(obj interface{}) (interface{}, error) {
		event, ok := obj.(*corev1.Event)
		if !ok {
			return nil, workloadProjectionError("ingest: event projector received a non-Event object")
		}
		projected := record(event)
		return ingest.Bundle{Table: projectEventRow(meta, event), Catalog: projected.summary, Aggregate: projected.fact}, nil
	}
}

// eventRecord is one Event as its serve-time readers see it.
type eventRecord struct {
	summary objectcatalog.Summary
	fact    *EventFact
}

// newEventRecordProjector projects Events the way intake does, for Events
// read from the API instead of the store.
func newEventRecordProjector(clusterID string) func(*corev1.Event) eventRecord {
	catalog := objectcatalog.SummaryProjector(clusterID, eventres.Identity)
	return func(event *corev1.Event) eventRecord {
		summary, _ := catalog(event).(objectcatalog.Summary)
		return eventRecord{summary: summary, fact: newEventFact(event)}
	}
}

// eventStore is the owned events reflector's store as its readers use it.
type eventStore interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
	RawHasSyncedFor(gvr schema.GroupVersionResource) bool
}

func eventsStoreSynced(events eventStore) bool {
	return events != nil && events.RawHasSyncedFor(EventGVR)
}

// visitStoredEvents calls visit for every Event the store holds. The fact is
// shared with the store and must not be modified; a reader copies the
// Summary only for the Events it keeps.
func visitStoredEvents(events eventStore, visit func(bundle ingest.Bundle, fact *EventFact)) {
	if events == nil {
		return
	}
	for _, row := range events.Rows(EventGVR) {
		bundle, ok := row.(ingest.Bundle)
		if !ok {
			continue
		}
		if fact, ok := bundle.Aggregate.(*EventFact); ok && fact != nil {
			visit(bundle, fact)
		}
	}
}

// storedEventRecords returns the stored Events keep accepts.
func storedEventRecords(events eventStore, keep func(*EventFact) bool) []eventRecord {
	var records []eventRecord
	visitStoredEvents(events, func(bundle ingest.Bundle, fact *EventFact) {
		if !keep(fact) {
			return
		}
		if summary, ok := bundle.Catalog.(objectcatalog.Summary); ok {
			records = append(records, eventRecord{summary: summary, fact: fact})
		}
	})
	return records
}

// compareEventRecordOrder orders Events most-recently-observed first, using
// the same latest-observation time the rows display, with deterministic
// tie-breaks.
func compareEventRecordOrder(left, right eventRecord) int {
	if left.fact.LastObserved != right.fact.LastObserved {
		if left.fact.LastObserved > right.fact.LastObserved {
			return -1
		}
		return 1
	}
	leftVersion := strings.TrimSpace(left.summary.ResourceVersion)
	rightVersion := strings.TrimSpace(right.summary.ResourceVersion)
	if leftVersion != rightVersion {
		if compareNumericStrings(leftVersion, rightVersion) > 0 {
			return -1
		}
		return 1
	}
	if order := strings.Compare(left.summary.Ref.UID, right.summary.Ref.UID); order != 0 {
		return order
	}
	return strings.Compare(left.summary.Ref.Name, right.summary.Ref.Name)
}

// eventTableSink feeds one Events table's maintained store from the owned
// events reflector. The bundle's Table half is the shared Events row; row
// selects and converts the rows this table serves. Each row the table adds,
// changes, or removes rings its debounced doorbell with the row's
// involved-object namespace. Sinks run under the events store's write lock.
type eventTableSink[T any] struct {
	store    *typedMaintainedStore[T]
	row      func(EventSummary) (T, bool)
	summary  func(T) EventSummary
	notifier *EventTableChangeNotifier
}

var _ ingest.BundleReplacer = (*eventTableSink[EventSummary])(nil)

func (s *eventTableSink[T]) UpsertBundle(bundle ingest.Bundle) {
	summary, ok := bundle.Table.(EventSummary)
	if !ok {
		return
	}
	row, keep := s.row(summary)
	if !keep {
		// The table does not serve this Event; drop a row it served before.
		s.DeleteBundle(bundle)
		return
	}
	s.store.store.Upsert(row)
	s.store.bumpSinkVersion()
	s.notifier.changed(summary.ObjectNamespace)
}

func (s *eventTableSink[T]) DeleteBundle(bundle ingest.Bundle) {
	catalog := catalogOf(bundle)
	if catalog == nil {
		return
	}
	removed, existed := s.store.store.DeleteReturning(keyFromCatalog(*catalog))
	if !existed {
		return
	}
	s.store.bumpSinkVersion()
	s.notifier.changed(s.summary(removed).ObjectNamespace)
}

// ReplaceBundles installs a relist and rings only the namespaces whose rows
// it added, changed, or removed: a relist re-delivers every Event, and an
// unchanged one must not refetch every open Events table.
func (s *eventTableSink[T]) ReplaceBundles(bundles []ingest.Bundle) {
	previous := make(map[string]EventSummary)
	for _, row := range s.store.store.Snapshot() {
		previous[s.store.adapter.Key(row)] = s.summary(row)
	}
	changed := make(map[string]struct{})
	rows := make([]T, 0, len(bundles))
	for _, bundle := range bundles {
		summary, ok := bundle.Table.(EventSummary)
		if !ok {
			continue
		}
		row, keep := s.row(summary)
		if !keep {
			continue
		}
		rows = append(rows, row)
		key := s.store.adapter.Key(row)
		before, existed := previous[key]
		delete(previous, key)
		if !existed || before.ResourceVersion != summary.ResourceVersion {
			changed[summary.ObjectNamespace] = struct{}{}
		}
	}
	for _, removed := range previous {
		changed[removed.ObjectNamespace] = struct{}{}
	}
	s.store.store.ReplaceWhere(rows, func(T) bool { return true })
	s.store.bumpSinkVersion()
	for namespace := range changed {
		s.notifier.changed(namespace)
	}
}

// namespaceEventSink tells the namespaces notifier that the events store
// changed; the notifier recounts warnings and rings only when a count changes.
type namespaceEventSink struct {
	notifier *NamespaceChangeNotifier
}

var _ ingest.BundleReplacer = namespaceEventSink{}

func (s namespaceEventSink) UpsertBundle(ingest.Bundle)     { s.notifier.EventChanged() }
func (s namespaceEventSink) DeleteBundle(ingest.Bundle)     { s.notifier.EventChanged() }
func (s namespaceEventSink) ReplaceBundles([]ingest.Bundle) { s.notifier.EventChanged() }
