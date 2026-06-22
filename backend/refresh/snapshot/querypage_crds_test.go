package snapshot

import (
	"fmt"
	"slices"
	"testing"
)

func makeCRDRows(n int) []ClusterCRDEntry {
	groups := []string{"example.com", "acme.io", "k8s.io"}
	scopes := []string{"Namespaced", "Cluster"}
	versions := []string{"v1", "v1beta1", "v2"}
	rows := make([]ClusterCRDEntry, n)
	for i := 0; i < n; i++ {
		rows[i] = ClusterCRDEntry{
			Kind:           "CustomResourceDefinition",
			Name:           fmt.Sprintf("widget-%03d.example.com", i), // unique -> unique row key
			Group:          groups[i%len(groups)],
			Scope:          scopes[i%len(scopes)],
			Details:        fmt.Sprintf("d-%d", i%4), // ties
			StorageVersion: versions[i%len(versions)],
			TypeAlias:      fmt.Sprintf("alias-%d", i%3),
			Age:            fmt.Sprintf("%dm", i%5),
			AgeTimestamp:   int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
		}
	}
	return rows
}

// TestClusterCRDQueryViaStoreEquivalent is the cluster-crds cutover gate: the
// engine-backed serve path must produce the SAME page as the live
// applyTypedTableQuery — identical rows across full pagination, totals, and facet
// value lists — across a matrix of sorts × directions × kind filters × searches. CRDs
// are cluster-scoped (no namespace) and all kind "CustomResourceDefinition".
func TestClusterCRDQueryViaStoreEquivalent(t *testing.T) {
	adapter := clusterCRDTableQueryAdapter()
	items := makeCRDRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[ClusterCRDEntry], base typedTableQuery) ([]string, typedTableQueryPage[ClusterCRDEntry]) {
		q := base
		var keys []string
		var first typedTableQueryPage[ClusterCRDEntry]
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
	sorts := []string{"", "name", "kind", "group", "scope", "details", "version", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{kinds: []string{"CustomResourceDefinition"}},
		{search: "widget-01"},
		{search: "acme"},
		{search: "alias-1"},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Kinds: f.kinds, Search: f.search,
						// CRD search includes TypeAlias only via IncludeMetadata? No —
						// TypeAlias is part of the adapter's plain SearchText, so a plain
						// search matches it without IncludeMetadata.
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[ClusterCRDEntry] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[ClusterCRDEntry] {
					return applyTypedTableQueryViaStore(items, q, adapter, crdsQuerypageSchema())
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
