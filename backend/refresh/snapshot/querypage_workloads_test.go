package snapshot

import (
	"fmt"
	"slices"
	"testing"
)

// makeWorkloadRows builds varied WorkloadSummary rows. It sets the fields the
// adapter sorts/searches on (kind, name, namespace, status, ready) plus the fields
// the health predicate reads (restarts, ready, statusPresentation) so the
// predicate-query equivalence cases below actually filter a mixed set.
func makeWorkloadRows(n int) []WorkloadSummary {
	kinds := []string{"Deployment", "StatefulSet", "Pod", "DaemonSet"}
	namespaces := []string{"default", "kube-system", "app"}
	statuses := []string{"Running", "Pending", "Degraded"}
	presentations := []string{"healthy", "warning", "error", "not-ready"}
	rows := make([]WorkloadSummary, n)
	for i := 0; i < n; i++ {
		ready := i % 4 // some "k/k" (ready) and some "k/k+1" (not-ready)
		total := ready
		if i%3 == 0 {
			total = ready + 1
		}
		rows[i] = WorkloadSummary{
			Kind:               kinds[i%len(kinds)],
			Name:               fmt.Sprintf("wl-%03d", i), // unique -> unique row key
			Namespace:          namespaces[i%len(namespaces)],
			Status:             statuses[i%len(statuses)],
			Ready:              fmt.Sprintf("%d/%d", ready, total),
			Restarts:           int32((i * 7) % 5), // many zeros and non-zeros
			StatusPresentation: presentations[i%len(presentations)],
			Age:                fmt.Sprintf("%dm", i%5),
			AgeTimestamp:       int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
			CPUUsage:           fmt.Sprintf("%dm", (i%6)*50),
			MemUsage:           fmt.Sprintf("%dMi", (i%6)*64),
		}
	}
	return rows
}

// TestWorkloadsQueryViaStoreEquivalent is the workloads cutover gate: the
// engine-backed serve path must produce the SAME page as the live
// applyTypedTableQuery — identical rows across full pagination, totals, and facet
// value lists — across a matrix of sorts × directions × namespace/kind filters ×
// status filters × searches AND health-predicate queries (the engine only honors predicates because
// applyTypedTableQueryViaStore now builds its store from the matched set).
func TestWorkloadsQueryViaStoreEquivalent(t *testing.T) {
	adapter := workloadTableQueryAdapter()
	items := makeWorkloadRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[WorkloadSummary], base typedTableQuery) ([]string, typedTableQueryPage[WorkloadSummary]) {
		q := base
		var keys []string
		var first typedTableQueryPage[WorkloadSummary]
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
		ns         []string
		kinds      []string
		statuses   []string
		search     string
		predicates []ResourceQueryPredicate
	}
	sorts := []string{"", "name", "kind", "namespace", "status", "ready", "restarts", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{ns: []string{"default"}},
		{ns: []string{"default", "app"}},
		{kinds: []string{"Pod"}},
		{ns: []string{"kube-system"}, kinds: []string{"Deployment"}},
		{statuses: []string{"Pending"}},
		{statuses: []string{"Running", "Degraded"}},
		{ns: []string{"default"}, statuses: []string{"Running"}},
		{search: "wl-01"},
		{search: "running"},
		{predicates: []ResourceQueryPredicate{{Field: "health", Value: "restarts"}}},
		{predicates: []ResourceQueryPredicate{{Field: "health", Value: "not-ready"}}},
		{predicates: []ResourceQueryPredicate{{Field: "health", Value: "unhealthy"}}},
		{ns: []string{"default"}, predicates: []ResourceQueryPredicate{{Field: "health", Value: "restarts"}}},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Namespaces: f.ns, Kinds: f.kinds, Facets: map[string][]string{"statuses": f.statuses}, Search: f.search, Predicates: f.predicates,
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[WorkloadSummary] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[WorkloadSummary] {
					return applyTypedTableQueryViaStore(items, q, adapter, workloadsQuerypageSchema())
				}, base)

				label := fmt.Sprintf("sort=%q dir=%s ns=%v kinds=%v statuses=%v search=%q preds=%v", sf, d, f.ns, f.kinds, f.statuses, f.search, f.predicates)
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

func TestWorkloadQueryFiltersStatusAndKeepsScopeFacets(t *testing.T) {
	items := makeWorkloadRows(12)
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID: "c",
			Facets:    map[string][]string{"statuses": {"Pending"}},
			Limit:     50,
		},
	}

	page := applyTypedTableQueryViaStore(items, query, workloadTableQueryAdapter(), workloadsQuerypageSchema())

	if page.Total != 4 {
		t.Fatalf("filtered total = %d, want 4 Pending workloads", page.Total)
	}
	for _, row := range page.Rows {
		if row.Status != "Pending" {
			t.Fatalf("status-filtered page contains %q row", row.Status)
		}
	}
	if got := testFacetOptionValues(page.FacetValues, "statuses"); !slices.Equal(got, []string{"Degraded", "Pending", "Running"}) {
		t.Fatalf("status facets = %v, want full structural-scope options", got)
	}
}

func TestWorkloadStatusFacetsStayStableAcrossHealthPredicate(t *testing.T) {
	items := []WorkloadSummary{
		{Kind: "Deployment", Namespace: "team-a", Name: "healthy", Status: "Running", StatusPresentation: "healthy"},
		{Kind: "Deployment", Namespace: "team-a", Name: "pending", Status: "Pending", StatusPresentation: "warning"},
		{Kind: "StatefulSet", Namespace: "team-a", Name: "degraded", Status: "Degraded", StatusPresentation: "error"},
		{Kind: "Pod", Namespace: "team-a", Name: "failing", Status: "Running", StatusPresentation: "error"},
	}
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID:  "c",
			Facets:     map[string][]string{"statuses": {"Pending"}},
			Predicates: []ResourceQueryPredicate{{Field: "health", Value: "unhealthy"}},
			Limit:      50,
		},
	}

	page := applyTypedTableQueryViaStore(items, query, workloadTableQueryAdapter(), workloadsQuerypageSchema())

	if page.Total != 1 || len(page.Rows) != 1 || page.Rows[0].Name != "pending" {
		t.Fatalf("status + health query rows = %#v total=%d, want pending only", page.Rows, page.Total)
	}
	if got := testFacetOptionValues(page.FacetValues, "statuses"); !slices.Equal(got, []string{"Degraded", "Pending", "Running"}) {
		t.Fatalf("status facets = %v, want full structural-scope options", got)
	}
}

// TestWorkloadMetricSortQueryViaStoreEquivalent proves the engine serves cpu/memory
// (live usage) sorts byte-identically to the live executor on the BASE workloads
// adapter — the query shape metric-sorted tables use after the serve-time join.
func TestWorkloadMetricSortQueryViaStoreEquivalent(t *testing.T) {
	adapter := workloadTableQueryAdapter()
	items := makeWorkloadRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[WorkloadSummary], base typedTableQuery) ([]string, typedTableQueryPage[WorkloadSummary]) {
		q := base
		var keys []string
		var first typedTableQueryPage[WorkloadSummary]
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

	for _, sf := range []string{"cpu", "memory"} {
		for _, d := range []string{"asc", "desc"} {
			base := typedTableQuery{
				Enabled: true,
				Request: ResourceQueryRequest{
					ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
					Namespaces: []string{"default", "app"},
					Kinds:      []string{"Deployment", "Pod"},
					Search:     "wl-0",
				},
				DynamicRevision: "metrics-rev-1",
			}
			liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[WorkloadSummary] {
				return applyTypedTableQuery(items, q, adapter)
			}, base)
			engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[WorkloadSummary] {
				return applyTypedTableQueryViaStore(items, q, adapter, workloadsQuerypageSchema())
			}, base)

			label := fmt.Sprintf("sort=%q dir=%s", sf, d)
			if !slices.Equal(liveKeys, engineKeys) {
				t.Fatalf("%s: row sequence differs (live=%d engine=%d rows)", label, len(liveKeys), len(engineKeys))
			}
			if liveFirst.Total != engineFirst.Total {
				t.Fatalf("%s: total live=%d engine=%d", label, liveFirst.Total, engineFirst.Total)
			}
			if !slices.Equal(testFacetOptionValues(liveFirst.FacetValues, "statuses"), testFacetOptionValues(engineFirst.FacetValues, "statuses")) {
				t.Fatalf("%s: status facets live=%v engine=%v", label, liveFirst.FacetValues, engineFirst.FacetValues)
			}
		}
	}
}
