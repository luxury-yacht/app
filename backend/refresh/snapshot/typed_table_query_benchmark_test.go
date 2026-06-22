/*
 * backend/refresh/snapshot/typed_table_query_benchmark_test.go
 *
 * Benchmarks the one-shot apply path — the oracle the querypage-engine
 * equivalence tests compare against — at realistic row counts. apply runs per
 * keystroke and per tick on the largest tables (pods), so per-row cost dominates
 * UI latency on big clusters.
 */

package snapshot

import (
	"fmt"
	"math/rand"
	"testing"
)

func benchmarkTypedQueryRows(count int) []typedQueryTestRow {
	rng := rand.New(rand.NewSource(7))
	namespaces := []string{"default", "kube-system", "team-a", "team-b", "team-c"}
	kinds := []string{"Pod"}
	rows := make([]typedQueryTestRow, 0, count)
	for i := 0; i < count; i += 1 {
		namespace := namespaces[rng.Intn(len(namespaces))]
		name := fmt.Sprintf("pod-%06d", rng.Intn(count))
		rows = append(rows, typedQueryTestRow{
			key:       fmt.Sprintf("%s/%s-%d", namespace, name, i),
			name:      name,
			namespace: namespace,
			kind:      kinds[0],
			cpu:       rng.Float64() * 4000,
		})
	}
	return rows
}

func benchmarkTypedQuery(sortField string) typedTableQuery {
	return typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "pods",
			SortField:     sortField,
			SortDirection: "asc",
			Limit:         100,
			Search:        "pod",
		},
	}
}

func BenchmarkApplyTypedTableQuery(b *testing.B) {
	rows := benchmarkTypedQueryRows(100_000)
	for _, sortField := range []string{"name", "cpu"} {
		b.Run(sortField, func(b *testing.B) {
			query := benchmarkTypedQuery(sortField)
			b.ReportAllocs()
			for i := 0; i < b.N; i += 1 {
				page := applyTypedTableQuery(rows, query, typedQueryTestAdapter())
				if len(page.Rows) != query.Request.Limit {
					b.Fatalf("expected a full page, got %d rows", len(page.Rows))
				}
			}
		})
	}
}
