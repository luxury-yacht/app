package snapshot

import (
	"fmt"
	"reflect"
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

// makeClusterEventRows builds varied ClusterEventEntry rows. These Events involve
// cluster-scoped objects, but the Event resources themselves remain namespaced.
func makeClusterEventRows(n int) []ClusterEventEntry {
	namespaces := []string{"default", "kube-system"}
	types := []string{"Normal", "Warning"}
	sources := []string{"node-controller", "kubelet", "scheduler"}
	reasons := []string{"RegisteredNode", "NodeNotReady", "Rebooted", "Starting"}
	rows := make([]ClusterEventEntry, n)
	for i := 0; i < n; i++ {
		rows[i] = ClusterEventEntry{
			Kind:         "Event",
			Name:         fmt.Sprintf("cevt-%03d", i), // unique -> unique row key
			Namespace:    namespaces[i%len(namespaces)],
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

func TestClusterEventQueryIdentityIncludesEventNamespace(t *testing.T) {
	adapter := clusterEventTableQueryAdapter()
	first := ClusterEventEntry{Kind: "Event", Namespace: "default", Name: "node-ready.123"}
	second := ClusterEventEntry{Kind: "Event", Namespace: "kube-system", Name: "node-ready.123"}

	if adapter.Key(first) == adapter.Key(second) {
		t.Fatalf("cluster Event row keys collapse namespaces: %q", adapter.Key(first))
	}
	if got := adapter.Namespace(first); got != "default" {
		t.Fatalf("cluster Event adapter namespace = %q, want default", got)
	}
	if got := adapter.AnchorKey("Event", first.Namespace, first.Name); got != adapter.Key(first) {
		t.Fatalf("cluster Event anchor key = %q, want row key %q", got, adapter.Key(first))
	}
}

func TestNamespaceEventsQueryFacetsFilterAndKeepStructuralScopeOptions(t *testing.T) {
	items := []EventSummary{
		{Name: "normal", Namespace: "team-a", Kind: "Pod", Type: "Normal", Reason: "Started", Source: "kubelet"},
		{Name: "warning", Namespace: "team-a", Kind: "Pod", Type: "Warning", Reason: "BackOff", Source: "node-controller"},
	}
	page := applyTypedTableQueryViaStore(
		items,
		typedTableQuery{
			Enabled: true,
			Request: ResourceQueryRequest{
				ClusterID: "cluster-a",
				Limit:     50,
				Facets:    map[string][]string{"types": {"Warning"}},
			},
		},
		namespacedEventTableQueryAdapter(),
		namespaceEventsQuerypageSchema(),
	)

	if got := len(page.Rows); got != 1 || page.Rows[0].Name != "warning" {
		t.Fatalf("type facet rows = %+v, want only warning", page.Rows)
	}
	if got := testFacetOptionValues(page.FacetValues, "types"); !slices.Equal(got, []string{"Normal", "Warning"}) {
		t.Fatalf("type options = %v, want full structural scope", got)
	}
	if got := testFacetOptionValues(page.FacetValues, "reasons"); !slices.Equal(got, []string{"BackOff", "Started"}) {
		t.Fatalf("reason options = %v, want full structural scope", got)
	}
	if got := testFacetOptionValues(page.FacetValues, "sources"); !slices.Equal(got, []string{"kubelet", "node-controller"}) {
		t.Fatalf("source options = %v, want full structural scope", got)
	}
}

func TestClusterEventsQueryFacetsFilterAndKeepStructuralScopeOptions(t *testing.T) {
	items := []ClusterEventEntry{
		{Name: "normal", Kind: "Event", Type: "Normal", Reason: "RegisteredNode", Source: "node-controller"},
		{Name: "warning", Kind: "Event", Type: "Warning", Reason: "NodeNotReady", Source: "kubelet"},
	}
	page := applyTypedTableQueryViaStore(
		items,
		typedTableQuery{
			Enabled: true,
			Request: ResourceQueryRequest{
				ClusterID: "cluster-a",
				Limit:     50,
				Facets:    map[string][]string{"reasons": {"NodeNotReady"}},
			},
		},
		clusterEventTableQueryAdapter(),
		clusterEventsQuerypageSchema(),
	)

	if got := len(page.Rows); got != 1 || page.Rows[0].Name != "warning" {
		t.Fatalf("reason facet rows = %+v, want only warning", page.Rows)
	}
	if got := testFacetOptionValues(page.FacetValues, "types"); !slices.Equal(got, []string{"Normal", "Warning"}) {
		t.Fatalf("type options = %v, want full structural scope", got)
	}
	if got := testFacetOptionValues(page.FacetValues, "reasons"); !slices.Equal(got, []string{"NodeNotReady", "RegisteredNode"}) {
		t.Fatalf("reason options = %v, want full structural scope", got)
	}
	if got := testFacetOptionValues(page.FacetValues, "sources"); !slices.Equal(got, []string{"kubelet", "node-controller"}) {
		t.Fatalf("source options = %v, want full structural scope", got)
	}
}

func TestEventQueryFacetsPublishExactEmptyOptionSets(t *testing.T) {
	namespaced := applyTypedTableQueryViaStore(
		[]EventSummary{},
		typedTableQuery{Enabled: true, Request: ResourceQueryRequest{ClusterID: "cluster-a", Limit: 50}},
		namespacedEventTableQueryAdapter(),
		namespaceEventsQuerypageSchema(),
	)
	cluster := applyTypedTableQueryViaStore(
		[]ClusterEventEntry{},
		typedTableQuery{Enabled: true, Request: ResourceQueryRequest{ClusterID: "cluster-a", Limit: 50}},
		clusterEventTableQueryAdapter(),
		clusterEventsQuerypageSchema(),
	)

	for label, facets := range map[string][]ResourceQueryFacetValues{
		"namespace": namespaced.FacetValues,
		"cluster":   cluster.FacetValues,
	} {
		if len(facets) != 3 {
			t.Fatalf("%s event facets = %v, want three empty option sets", label, facets)
		}
		for _, facet := range facets {
			if !facet.Exact || len(facet.Options) != 0 {
				t.Fatalf("%s event facet = %+v, want exact empty options", label, facet)
			}
		}
	}
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
		facets map[string][]string
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
		{facets: map[string][]string{"types": {"Warning"}}},
		{facets: map[string][]string{"reasons": {"BackOff", "Started"}, "sources": {"kubelet"}}},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Namespaces: f.ns, Kinds: f.kinds, Search: f.search, Facets: f.facets,
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[EventSummary] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[EventSummary] {
					return applyTypedTableQueryViaStore(items, q, adapter, namespaceEventsQuerypageSchema())
				}, base)

				label := fmt.Sprintf("sort=%q dir=%s ns=%v kinds=%v search=%q facets=%v", sf, d, f.ns, f.kinds, f.search, f.facets)
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
				if !reflect.DeepEqual(liveFirst.FacetValues, engineFirst.FacetValues) {
					t.Fatalf("%s: provider facets live=%v engine=%v", label, liveFirst.FacetValues, engineFirst.FacetValues)
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
		facets map[string][]string
	}
	sorts := []string{"", "name", "kind", "type", "source", "reason", "object", "objectType", "objectName", "message", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{kinds: []string{"Event"}},
		{search: "cevt-01"},
		{search: "warning"},
		{search: "node"},
		{facets: map[string][]string{"types": {"Warning"}}},
		{facets: map[string][]string{"reasons": {"NodeNotReady"}, "sources": {"kubelet"}}},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Kinds: f.kinds, Search: f.search, Facets: f.facets,
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[ClusterEventEntry] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[ClusterEventEntry] {
					return applyTypedTableQueryViaStore(items, q, adapter, clusterEventsQuerypageSchema())
				}, base)

				label := fmt.Sprintf("sort=%q dir=%s kinds=%v search=%q facets=%v", sf, d, f.kinds, f.search, f.facets)
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
				if !reflect.DeepEqual(liveFirst.FacetValues, engineFirst.FacetValues) {
					t.Fatalf("%s: provider facets live=%v engine=%v", label, liveFirst.FacetValues, engineFirst.FacetValues)
				}
			}
		}
	}
}
