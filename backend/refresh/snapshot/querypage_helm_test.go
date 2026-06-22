package snapshot

import (
	"fmt"
	"slices"
	"testing"
)

func makeHelmRows(n int) []NamespaceHelmSummary {
	namespaces := []string{"default", "kube-system", "app"}
	charts := []string{"nginx-1.2.3", "redis-7.0.0", "postgres-15.1"}
	appVersions := []string{"1.2.3", "7.0.0", "15.1"}
	statuses := []string{"deployed", "failed", "pending-install"}
	rows := make([]NamespaceHelmSummary, n)
	for i := 0; i < n; i++ {
		rows[i] = NamespaceHelmSummary{
			Name:         fmt.Sprintf("rel-%03d", i), // unique -> unique row key
			Namespace:    namespaces[i%len(namespaces)],
			Chart:        charts[i%len(charts)],
			AppVersion:   appVersions[i%len(appVersions)],
			Status:       statuses[i%len(statuses)],
			Revision:     i % 7, // ties, numeric sort engages
			Updated:      fmt.Sprintf("2026-06-%02dT00:00:00Z", 1+(i%28)),
			Description:  fmt.Sprintf("desc-%d", i%4),
			Age:          fmt.Sprintf("%dm", i%5),
			AgeTimestamp: int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
		}
	}
	return rows
}

// TestHelmQueryViaStoreEquivalent is the helm cutover gate: the engine-backed serve
// path must produce the SAME page as the live applyTypedTableQuery — identical rows
// across full pagination, totals, and facet value lists — across a matrix of sorts ×
// directions × namespace filters × searches. Helm rows are all kind "HelmRelease", so
// kind filtering is exercised as a no-op alongside namespace filters.
func TestHelmQueryViaStoreEquivalent(t *testing.T) {
	adapter := helmTableQueryAdapter()
	items := makeHelmRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[NamespaceHelmSummary], base typedTableQuery) ([]string, typedTableQueryPage[NamespaceHelmSummary]) {
		q := base
		var keys []string
		var first typedTableQueryPage[NamespaceHelmSummary]
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
	sorts := []string{"", "name", "kind", "namespace", "chart", "appVersion", "status", "revision", "updated", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{ns: []string{"default"}},
		{ns: []string{"default", "app"}},
		{kinds: []string{"HelmRelease"}},
		{ns: []string{"kube-system"}, kinds: []string{"HelmRelease"}},
		{search: "rel-01"},
		{search: "nginx"},
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
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[NamespaceHelmSummary] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[NamespaceHelmSummary] {
					return applyTypedTableQueryViaStore(items, q, adapter, helmQuerypageSchema())
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
