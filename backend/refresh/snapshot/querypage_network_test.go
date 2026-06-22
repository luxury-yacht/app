package snapshot

import (
	"fmt"
	"slices"
	"testing"
)

func makeNetworkRows(n int) []NetworkSummary {
	kinds := []string{"Service", "Ingress", "NetworkPolicy"}
	namespaces := []string{"default", "kube-system", "app"}
	rows := make([]NetworkSummary, n)
	for i := 0; i < n; i++ {
		rows[i] = NetworkSummary{
			Kind:         kinds[i%len(kinds)],
			Name:         fmt.Sprintf("net-%03d", i), // unique -> unique row key
			Namespace:    namespaces[i%len(namespaces)],
			Details:      fmt.Sprintf("d-%d", i%4), // many ties
			Age:          fmt.Sprintf("%dm", i%5),
			AgeTimestamp: int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
		}
	}
	return rows
}

// TestNetworkQueryViaStoreEquivalent is the network cutover gate: the engine-backed
// serve path must produce the SAME page as the live applyTypedTableQuery — identical
// rows across full pagination, totals, and facet value lists — across a matrix of
// sorts × directions × namespace/kind filters × searches.
func TestNetworkQueryViaStoreEquivalent(t *testing.T) {
	adapter := networkTableQueryAdapter()
	items := makeNetworkRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[NetworkSummary], base typedTableQuery) ([]string, typedTableQueryPage[NetworkSummary]) {
		q := base
		var keys []string
		var first typedTableQueryPage[NetworkSummary]
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
	sorts := []string{"", "name", "kind", "namespace", "details", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{ns: []string{"default"}},
		{ns: []string{"default", "app"}},
		{kinds: []string{"Service"}},
		{ns: []string{"kube-system"}, kinds: []string{"Ingress"}},
		{search: "net-01"},
		{search: "service"},
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
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[NetworkSummary] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[NetworkSummary] {
					return applyTypedTableQueryViaStore(items, q, adapter, networkQuerypageSchema())
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
