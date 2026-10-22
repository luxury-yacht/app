package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// projectingEventStore reads one events ProjectingStore the way the builders
// read the ingest manager.
type projectingEventStore struct{ store *ingest.ProjectingStore }

func (s projectingEventStore) Rows(gvr schema.GroupVersionResource) []interface{} {
	if gvr != EventGVR {
		return nil
	}
	return s.store.List()
}

func (s projectingEventStore) RawHasSyncedFor(gvr schema.GroupVersionResource) bool {
	return gvr == EventGVR && s.store.HasSynced()
}

// PartitionReadinessFor reports the one cluster-wide partition an unscoped
// events store has, as the ingest manager does: Ready once it has synced.
func (s projectingEventStore) PartitionReadinessFor(gvr schema.GroupVersionResource) []ingest.PartitionReadiness {
	if gvr != EventGVR {
		return nil
	}
	state := refresh.ResourceReadinessPending
	if s.store.HasSynced() {
		state = refresh.ResourceReadinessReady
	}
	return []ingest.PartitionReadiness{{Namespace: "", State: state}}
}

// newEventStore lists events into a store through the production events
// projector, the way the owned reflector's initial list delivers them.
func newEventStore(t testing.TB, meta ClusterMeta, events ...*corev1.Event) projectingEventStore {
	t.Helper()
	store := ingest.NewProjectingStore(NewEventIngestProjector(meta))
	list := make([]interface{}, 0, len(events))
	for _, event := range events {
		list = append(list, event)
	}
	require.NoError(t, store.Replace(list, "1"))
	return projectingEventStore{store: store}
}

// eventRecordOf projects one Event the way intake does.
func eventRecordOf(meta ClusterMeta, event *corev1.Event) eventRecord {
	return newEventRecordProjector(meta.ClusterID)(event)
}

// eventBundleOf projects one Event into the bundle the events store hands its sinks.
func eventBundleOf(t testing.TB, meta ClusterMeta, event *corev1.Event) ingest.Bundle {
	t.Helper()
	projected, err := NewEventIngestProjector(meta)(event)
	require.NoError(t, err)
	return projected.(ingest.Bundle)
}

// feedEventTable lists events through the production events projector into a
// store whose only sink is the table's events sink, the way the owned
// reflector's initial list fills an Events table.
func feedEventTable[T any](t testing.TB, meta ClusterMeta, maintained *typedMaintainedStore[T], row func(EventSummary) (T, bool), summary func(T) EventSummary, events ...*corev1.Event) {
	t.Helper()
	bell := newRecordingBell()
	t.Cleanup(bell.Stop)
	store := ingest.NewProjectingStore(NewEventIngestProjector(meta))
	store.AddBundleSink(&eventTableSink[T]{store: maintained, row: row, summary: summary, notifier: newEventTableChangeNotifier(bell, "events-test", "t")})
	list := make([]interface{}, 0, len(events))
	for _, event := range events {
		list = append(list, event)
	}
	require.NoError(t, store.Replace(list, "1"))
}
