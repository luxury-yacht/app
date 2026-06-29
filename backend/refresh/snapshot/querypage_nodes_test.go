package snapshot

import (
	"fmt"
	"slices"
	"testing"

	nodepkg "github.com/luxury-yacht/app/backend/resources/nodes"
)

func makeNodeRows(n int) []NodeSummary {
	statuses := []string{"Ready", "NotReady", "Unknown"}
	roles := []string{"control-plane", "worker", "control-plane,worker"}
	versions := []string{"v1.29.0", "v1.30.1", "v1.28.4"}
	rows := make([]NodeSummary, n)
	for i := 0; i < n; i++ {
		rows[i] = NodeSummary{
			Name:         fmt.Sprintf("node-%03d", i), // unique -> unique row key
			Kind:         "node",
			Status:       statuses[i%len(statuses)],
			Roles:        roles[i%len(roles)],
			Version:      versions[i%len(versions)],
			InternalIP:   fmt.Sprintf("10.0.%d.%d", i%4, i%7),
			CPUUsage:     fmt.Sprintf("%dm", (i%6)*100), // ties, numeric sort engages
			MemoryUsage:  fmt.Sprintf("%dMi", (i%5)*256),
			Pods:         fmt.Sprintf("%d/110", i%9), // ties
			Restarts:     int32(i % 4),
			Age:          fmt.Sprintf("%dm", i%5),
			AgeTimestamp: int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
		}
	}
	return rows
}

// TestNodeQueryViaStoreEquivalent is the nodes cutover gate: the engine-backed serve
// path must produce the SAME page as the live applyTypedTableQuery — identical rows
// across full pagination, totals, and facet value lists — across a matrix of sorts ×
// directions × searches. Nodes are cluster-scoped (no namespace) and unfiltered by
// kind, so the matrix exercises every sortable metric column plus searches.
func TestNodeQueryViaStoreEquivalent(t *testing.T) {
	adapter := nodeTableQueryAdapter()
	items := makeNodeRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[NodeSummary], base typedTableQuery) ([]string, typedTableQueryPage[NodeSummary]) {
		q := base
		var keys []string
		var first typedTableQueryPage[NodeSummary]
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
		search string
	}
	sorts := []string{"", "name", "status", "roles", "version", "pods", "restarts", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{search: "node-01"},
		{search: "ready"},
		{search: "v1.30"},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Search: f.search,
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[NodeSummary] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[NodeSummary] {
					return applyTypedTableQueryViaStore(items, q, adapter, nodesQuerypageSchema())
				}, base)

				label := fmt.Sprintf("sort=%q dir=%s search=%q", sf, d, f.search)
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

func TestNodeMetricsQueryViaStoreEquivalent(t *testing.T) {
	adapter := nodeMetricTableQueryAdapter()
	baseRows := makeNodeRows(250)
	items := make([]NodeMetricRow, 0, len(baseRows))
	for _, base := range baseRows {
		items = append(items, NodeMetricRow{
			ClusterMeta: ClusterMeta{ClusterID: "c"},
			Group:       nodepkg.Identity.Group,
			Version:     nodepkg.Identity.Version,
			Kind:        nodepkg.Identity.Kind,
			Resource:    nodepkg.Identity.Resource,
			Name:        base.Name,
			RowKey:      nodeTableQueryAdapter().Key(base),
			CPUUsage:    base.CPUUsage,
			MemoryUsage: base.MemoryUsage,
			base:        base,
		})
	}

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[NodeMetricRow], base typedTableQuery) ([]string, typedTableQueryPage[NodeMetricRow]) {
		q := base
		var keys []string
		var first typedTableQueryPage[NodeMetricRow]
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
					ClusterID:     "c",
					SortField:     sf,
					SortDirection: d,
					Limit:         17,
					Search:        "node-0",
				},
				DynamicRevision: "metrics-rev-1",
			}
			liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[NodeMetricRow] {
				return applyTypedTableQuery(items, q, adapter)
			}, base)
			engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[NodeMetricRow] {
				return applyTypedTableQueryViaStore(items, q, adapter, nodeMetricQuerypageSchema())
			}, base)

			label := fmt.Sprintf("sort=%q dir=%s", sf, d)
			if !slices.Equal(liveKeys, engineKeys) {
				t.Fatalf("%s: row sequence differs (live=%d engine=%d rows)", label, len(liveKeys), len(engineKeys))
			}
			if liveFirst.Total != engineFirst.Total {
				t.Fatalf("%s: total live=%d engine=%d", label, liveFirst.Total, engineFirst.Total)
			}
			if liveFirst.Dynamic == nil || engineFirst.Dynamic == nil || *liveFirst.Dynamic != *engineFirst.Dynamic {
				t.Fatalf("%s: dynamic live=%v engine=%v", label, liveFirst.Dynamic, engineFirst.Dynamic)
			}
		}
	}
}
