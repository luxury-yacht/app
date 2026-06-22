package snapshot

import (
	"fmt"
	"slices"
	"testing"
)

// makeEventSummaryRows builds varied EventSummary rows. It sets every field the
// namespaced-event adapter sorts/searches on (kind, name, namespace, type, source,
// reason, object, message) plus AgeTimestamp so the age sort engages on a set with
// ties — the precondition for an honest engine/live equivalence check.
func makeEventSummaryRows(n int) []EventSummary {
	kinds := []string{"Pod", "Deployment", "Node", "Service"}
	namespaces := []string{"default", "kube-system", "app"}
	types := []string{"Normal", "Warning"}
	sources := []string{"kubelet", "scheduler", "controller-manager"}
	reasons := []string{"Started", "Killing", "FailedScheduling", "BackOff"}
	rows := make([]EventSummary, n)
	for i := 0; i < n; i++ {
		rows[i] = EventSummary{
			Kind:         kinds[i%len(kinds)],
			Name:         fmt.Sprintf("evt-%03d", i), // unique -> unique row key
			Namespace:    namespaces[i%len(namespaces)],
			Type:         types[i%len(types)],
			Source:       sources[i%len(sources)],
			Reason:       reasons[i%len(reasons)],
			Object:       fmt.Sprintf("%s/obj-%d", kinds[i%len(kinds)], i%7),
			Message:      fmt.Sprintf("message %d for %s", i%5, kinds[i%len(kinds)]),
			Age:          fmt.Sprintf("%dm", i%5),
			AgeTimestamp: int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
		}
	}
	return rows
}

// makeClusterEventRows builds varied ClusterEventEntry rows. Cluster events are
// cluster-scoped (no namespace), so the adapter keys/searches/sorts without a
// namespace dimension; this still exercises kind/type/source/reason/object/message
// sorts and searches plus the age tiebreak.
func makeClusterEventRows(n int) []ClusterEventEntry {
	types := []string{"Normal", "Warning"}
	sources := []string{"node-controller", "kubelet", "scheduler"}
	reasons := []string{"RegisteredNode", "NodeNotReady", "Rebooted", "Starting"}
	rows := make([]ClusterEventEntry, n)
	for i := 0; i < n; i++ {
		rows[i] = ClusterEventEntry{
			Kind:         "Event",
			Name:         fmt.Sprintf("cevt-%03d", i), // unique -> unique row key
			Type:         types[i%len(types)],
			Source:       sources[i%len(sources)],
			Reason:       reasons[i%len(reasons)],
			Object:       fmt.Sprintf("Node/node-%d", i%6),
			Message:      fmt.Sprintf("cluster message %d", i%4),
			Age:          fmt.Sprintf("%dm", i%5),
			AgeTimestamp: int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
		}
	}
	return rows
}

// TestNamespaceEventsQueryViaStoreEquivalent is the namespace-events cutover gate:
// the engine-backed serve path must produce the SAME page as the live
// applyTypedTableQuery — identical rows across full pagination, totals, and facet
// value lists — across a matrix of sorts × directions × namespace/kind filters ×
// searches.
func TestNamespaceEventsQueryViaStoreEquivalent(t *testing.T) {
	adapter := namespacedEventTableQueryAdapter()
	items := makeEventSummaryRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[EventSummary], base typedTableQuery) ([]string, typedTableQueryPage[EventSummary]) {
		q := base
		var keys []string
		var first typedTableQueryPage[EventSummary]
		for i := 0; ; i++ {
			if i > 1000 {
				t.Fatal("pagination did not terminate")
			}
			page := serve(q)
			if i == 0 {
				first = page
			}
			for _, r := range page.Rows {
				keys = append(keys, adapter.Key(r))
			}
			if page.Continue == "" {
				break
			}
			q.Request.Continue = page.Continue
		}
		return keys, first
	}

	type filt struct {
		ns     []string
		kinds  []string
		search string
	}
	sorts := []string{"", "name", "kind", "namespace", "type", "source", "reason", "object", "objectType", "objectName", "message", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{ns: []string{"default"}},
		{ns: []string{"default", "app"}},
		{kinds: []string{"Pod"}},
		{ns: []string{"kube-system"}, kinds: []string{"Deployment"}},
		{search: "evt-01"},
		{search: "warning"},
		{search: "kubelet"},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Namespaces: f.ns, Kinds: f.kinds, Search: f.search,
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[EventSummary] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[EventSummary] {
					return applyTypedTableQueryViaStore(items, q, adapter, namespaceEventsQuerypageSchema())
				}, base)

				label := fmt.Sprintf("sort=%q dir=%s ns=%v kinds=%v search=%q", sf, d, f.ns, f.kinds, f.search)
				if !slices.Equal(liveKeys, engineKeys) {
					t.Fatalf("%s: row sequence differs (live=%d engine=%d rows)", label, len(liveKeys), len(engineKeys))
				}
				if liveFirst.Total != engineFirst.Total {
					t.Fatalf("%s: total live=%d engine=%d", label, liveFirst.Total, engineFirst.Total)
				}
				if liveFirst.UnfilteredTotal != engineFirst.UnfilteredTotal {
					t.Fatalf("%s: unfilteredTotal live=%d engine=%d", label, liveFirst.UnfilteredTotal, engineFirst.UnfilteredTotal)
				}
				if !slices.Equal(liveFirst.Namespaces, engineFirst.Namespaces) {
					t.Fatalf("%s: namespace facets live=%v engine=%v", label, liveFirst.Namespaces, engineFirst.Namespaces)
				}
				if !slices.Equal(liveFirst.Kinds, engineFirst.Kinds) {
					t.Fatalf("%s: kind facets live=%v engine=%v", label, liveFirst.Kinds, engineFirst.Kinds)
				}
			}
		}
	}
}

// TestClusterEventsQueryViaStoreEquivalent is the cluster-events cutover gate: the
// engine-backed serve path must produce the SAME page as the live
// applyTypedTableQuery — identical rows across full pagination, totals, and facet
// value lists — across a matrix of sorts × directions × kind filters × searches.
func TestClusterEventsQueryViaStoreEquivalent(t *testing.T) {
	adapter := clusterEventTableQueryAdapter()
	items := makeClusterEventRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[ClusterEventEntry], base typedTableQuery) ([]string, typedTableQueryPage[ClusterEventEntry]) {
		q := base
		var keys []string
		var first typedTableQueryPage[ClusterEventEntry]
		for i := 0; ; i++ {
			if i > 1000 {
				t.Fatal("pagination did not terminate")
			}
			page := serve(q)
			if i == 0 {
				first = page
			}
			for _, r := range page.Rows {
				keys = append(keys, adapter.Key(r))
			}
			if page.Continue == "" {
				break
			}
			q.Request.Continue = page.Continue
		}
		return keys, first
	}

	type filt struct {
		kinds  []string
		search string
	}
	sorts := []string{"", "name", "kind", "type", "source", "reason", "object", "objectType", "objectName", "message", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{kinds: []string{"Event"}},
		{search: "cevt-01"},
		{search: "warning"},
		{search: "node"},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Kinds: f.kinds, Search: f.search,
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[ClusterEventEntry] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[ClusterEventEntry] {
					return applyTypedTableQueryViaStore(items, q, adapter, clusterEventsQuerypageSchema())
				}, base)

				label := fmt.Sprintf("sort=%q dir=%s kinds=%v search=%q", sf, d, f.kinds, f.search)
				if !slices.Equal(liveKeys, engineKeys) {
					t.Fatalf("%s: row sequence differs (live=%d engine=%d rows)", label, len(liveKeys), len(engineKeys))
				}
				if liveFirst.Total != engineFirst.Total {
					t.Fatalf("%s: total live=%d engine=%d", label, liveFirst.Total, engineFirst.Total)
				}
				if liveFirst.UnfilteredTotal != engineFirst.UnfilteredTotal {
					t.Fatalf("%s: unfilteredTotal live=%d engine=%d", label, liveFirst.UnfilteredTotal, engineFirst.UnfilteredTotal)
				}
				if !slices.Equal(liveFirst.Namespaces, engineFirst.Namespaces) {
					t.Fatalf("%s: namespace facets live=%v engine=%v", label, liveFirst.Namespaces, engineFirst.Namespaces)
				}
				if !slices.Equal(liveFirst.Kinds, engineFirst.Kinds) {
					t.Fatalf("%s: kind facets live=%v engine=%v", label, liveFirst.Kinds, engineFirst.Kinds)
				}
			}
		}
	}
}
