package snapshot

import (
	"context"
	"math"
	"net/url"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
)

// TestParseFormattedMetricHandlesNoDataMarker proves the always-numeric CPU/memory
// sort parsers treat the no-data marker (streamrows.MetricsNoData, "-") as a
// deterministic -Inf sentinel rather than 0, so a cell with no metrics sample sorts
// at the no-data end (first ascending / last descending) and never collides with a
// real-zero cell. This is the sort contract the Risk #9 / §3.6 no-data overlay relies
// on (overlay now emits the marker instead of "0m"/"0Mi").
func TestParseFormattedMetricHandlesNoDataMarker(t *testing.T) {
	cpu, ok := parseFormattedCPUToMilli(streamrows.MetricsNoData)
	if !ok || !math.IsInf(cpu, -1) {
		t.Fatalf("CPU no-data marker: got (%v, %v), want (-Inf, true)", cpu, ok)
	}
	mem, ok := parseFormattedMemoryToBytes(streamrows.MetricsNoData)
	if !ok || !math.IsInf(mem, -1) {
		t.Fatalf("memory no-data marker: got (%v, %v), want (-Inf, true)", mem, ok)
	}

	// A real-zero cell ("0m"/"0Mi") parses to a finite 0 — strictly greater than the
	// no-data sentinel — so no-data and real-zero rows are ordered distinctly.
	zeroCPU, _ := parseFormattedCPUToMilli("0m")
	if zeroCPU <= cpu {
		t.Fatalf("real-zero CPU %v must sort above no-data %v", zeroCPU, cpu)
	}
	zeroMem, _ := parseFormattedMemoryToBytes("0Mi")
	if zeroMem <= mem {
		t.Fatalf("real-zero memory %v must sort above no-data %v", zeroMem, mem)
	}
}

type typedQueryTestRow struct {
	key       string
	name      string
	namespace string
	kind      string
	cpu       float64
}

func TestTypedTableQueryReportsInvalidCursor(t *testing.T) {
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "pods",
			SortField:     "name",
			SortDirection: "asc",
			Limit:         1,
			Continue:      "not-a-cursor",
		},
	}
	page := applyTypedTableQuery([]typedQueryTestRow{
		{key: "default/a", name: "a", namespace: "default", kind: "Pod"},
	}, query, typedQueryTestAdapter())

	if !page.CursorInvalid {
		t.Fatal("expected malformed cursor to be reported")
	}
	if page.Continue != "" {
		t.Fatalf("expected no follow-up cursor for single row, got %q", page.Continue)
	}
}

func TestTypedTableQueryIncludesDynamicRef(t *testing.T) {
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "pods",
			SortField:     "name",
			SortDirection: "asc",
			Limit:         1,
		},
		DynamicRevision: "rev-1",
	}
	page := applyTypedTableQuery([]typedQueryTestRow{
		{key: "default/a", name: "a", namespace: "default", kind: "Pod"},
		{key: "default/b", name: "b", namespace: "default", kind: "Pod"},
	}, query, typedQueryTestAdapter())

	if page.Dynamic == nil {
		t.Fatal("expected dynamic metadata")
	}
	if page.Dynamic.Revision != "rev-1" || page.Dynamic.Source != "metrics" {
		t.Fatalf("unexpected dynamic metadata: %+v", page.Dynamic)
	}
	if page.Continue == "" {
		t.Fatal("expected continue cursor")
	}
}

func TestTypedTableQueryContinuesCursorWhenDynamicRevisionChanges(t *testing.T) {
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "pods",
			SortField:     "cpu",
			SortDirection: "desc",
			Limit:         1,
		},
		DynamicRevision: "metrics-rev-1",
	}
	rows := []typedQueryTestRow{
		{key: "default/a", name: "a", namespace: "default", kind: "Pod", cpu: 100},
		{key: "default/b", name: "b", namespace: "default", kind: "Pod", cpu: 50},
	}
	page := applyTypedTableQuery(rows, query, typedQueryTestAdapter())
	if page.Continue == "" {
		t.Fatal("expected continue cursor from first dynamic page")
	}

	query.Request.Continue = page.Continue
	query.DynamicRevision = "metrics-rev-2"
	nextPage := applyTypedTableQuery(rows, query, typedQueryTestAdapter())
	if nextPage.CursorInvalid {
		t.Fatal("expected dynamic cursor to stay valid across metrics revision changes")
	}
	if len(nextPage.Rows) != 1 || nextPage.Rows[0].key != "default/b" {
		t.Fatalf("expected second row after dynamic revision change, got %+v", nextPage.Rows)
	}
}

// typedQueryMissingMetricRow models a numeric sort field that some rows are
// missing. Its SortValue for a missing row sorts AFTER every numeric-encoded
// value, which reproduces the historic bug where the page sort and the keyset
// cursor computed order differently and dropped or duplicated rows across pages.
type typedQueryMissingMetricRow struct {
	key       string
	metric    float64
	hasMetric bool
}

func typedQueryMissingMetricAdapter() typedTableQueryAdapter[typedQueryMissingMetricRow] {
	return typedTableQueryAdapter[typedQueryMissingMetricRow]{
		Key:        func(row typedQueryMissingMetricRow) string { return row.key },
		Namespace:  func(typedQueryMissingMetricRow) string { return "" },
		Kind:       func(typedQueryMissingMetricRow) string { return "Pod" },
		SearchText: func(typedQueryMissingMetricRow) []string { return nil },
		Predicate:  func(typedQueryMissingMetricRow, string, string) bool { return true },
		SortValue: func(row typedQueryMissingMetricRow, _ string) string {
			if !row.hasMetric {
				return "zzzz-missing"
			}
			return row.key
		},
		NumericSort: func(row typedQueryMissingMetricRow, _ string) (float64, bool) {
			if !row.hasMetric {
				return 0, false
			}
			return row.metric, true
		},
	}
}

// TestTypedTableQueryPaginationHasNoGapsWithMissingSortValues guards the keyset
// contract: the page sort and the cursor boundary must use one comparable value,
// so paging a field where some rows lack a value still visits every row exactly
// once with no duplicates or gaps, ascending and descending.
func TestTypedTableQueryPaginationHasNoGapsWithMissingSortValues(t *testing.T) {
	rows := []typedQueryMissingMetricRow{
		{key: "a", metric: 30, hasMetric: true},
		{key: "b", hasMetric: false},
		{key: "c", metric: 10, hasMetric: true},
		{key: "d", hasMetric: false},
		{key: "e", metric: 20, hasMetric: true},
	}

	fetchers := map[string]func(typedTableQuery) typedTableQueryPage[typedQueryMissingMetricRow]{
		"apply": func(query typedTableQuery) typedTableQueryPage[typedQueryMissingMetricRow] {
			return applyTypedTableQuery(rows, query, typedQueryMissingMetricAdapter())
		},
	}

	for path, fetch := range fetchers {
		for _, direction := range []string{"asc", "desc"} {
			seen := map[string]int{}
			continueToken := ""
			pages := 0
			for {
				query := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID:     "cluster-a",
						Table:         "pods",
						SortField:     "metric",
						SortDirection: direction,
						Limit:         2,
						Continue:      continueToken,
					},
				}
				page := fetch(query)
				if page.CursorInvalid {
					t.Fatalf("[%s/%s] unexpected cursor invalidation", path, direction)
				}
				for _, row := range page.Rows {
					seen[row.key]++
				}
				pages++
				if pages > 10 {
					t.Fatalf("[%s/%s] pagination did not terminate", path, direction)
				}
				if page.Continue == "" {
					break
				}
				continueToken = page.Continue
			}
			if len(seen) != len(rows) {
				t.Fatalf("[%s/%s] expected %d unique rows, saw %d: %v", path, direction, len(rows), len(seen), seen)
			}
			for key, count := range seen {
				if count != 1 {
					t.Fatalf("[%s/%s] row %q appeared %d times (dup/skip)", path, direction, key, count)
				}
			}
		}
	}
}

func TestTypedTableQueryPagesForwardWithExactTotals(t *testing.T) {
	rows := []typedQueryTestRow{
		{key: "default/a", name: "a", namespace: "default", kind: "Pod"},
		{key: "default/b", name: "b", namespace: "default", kind: "Pod"},
		{key: "default/c", name: "c", namespace: "default", kind: "Pod"},
	}
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "pods",
			SortField:     "name",
			SortDirection: "asc",
			Limit:         2,
		},
	}

	first := applyTypedTableQuery(rows, query, typedQueryTestAdapter())
	if len(first.Rows) != 2 {
		t.Fatalf("expected the page size (2) to be honored, got %d rows", len(first.Rows))
	}
	if first.Total != 3 || !first.TotalIsExact {
		t.Fatalf("typed totals must be the exact full match count; got total=%d exact=%v", first.Total, first.TotalIsExact)
	}
	if first.Continue == "" {
		t.Fatal("expected a continue cursor while rows remain")
	}
	if first.Rows[0].key != "default/a" || first.Rows[1].key != "default/b" {
		t.Fatalf("unexpected first-page order: %+v", first.Rows)
	}

	// Advance via the continue cursor: the next page returns the remaining row,
	// reports no further cursor, and still carries the exact full total.
	query.Request.Continue = first.Continue
	next := applyTypedTableQuery(rows, query, typedQueryTestAdapter())
	if next.CursorInvalid {
		t.Fatal("the continue cursor from page one must stay valid")
	}
	if len(next.Rows) != 1 || next.Rows[0].key != "default/c" {
		t.Fatalf("expected the final row on page two, got %+v", next.Rows)
	}
	if next.Continue != "" {
		t.Fatal("expected no continue cursor on the last page")
	}
	if next.Total != 3 || !next.TotalIsExact {
		t.Fatalf("expected exact total 3 on page two; got total=%d exact=%v", next.Total, next.TotalIsExact)
	}
}

func TestTypedTableQueryReportsUnfilteredTotalSeparateFromFiltered(t *testing.T) {
	rows := []typedQueryTestRow{
		{key: "default/a", name: "a", namespace: "default", kind: "Pod"},
		{key: "default/b", name: "b", namespace: "default", kind: "Pod"},
		{key: "default/c", name: "c", namespace: "default", kind: "Pod"},
	}
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "pods",
			Search:        "a",
			SortField:     "name",
			SortDirection: "asc",
			Limit:         50,
		},
	}

	page := applyTypedTableQuery(rows, query, typedQueryTestAdapter())
	if page.Total != 1 || !page.TotalIsExact {
		t.Fatalf("filtered total should be the search match count; got total=%d exact=%v", page.Total, page.TotalIsExact)
	}
	if page.UnfilteredTotal != 3 {
		t.Fatalf("unfiltered total should be the pre-filter row count; got %d, want 3", page.UnfilteredTotal)
	}
}

func TestTypedTableQueryInvalidatesCursorWhenPageSizeChanges(t *testing.T) {
	rows := []typedQueryTestRow{
		{key: "default/a", name: "a", namespace: "default", kind: "Pod"},
		{key: "default/b", name: "b", namespace: "default", kind: "Pod"},
		{key: "default/c", name: "c", namespace: "default", kind: "Pod"},
	}
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			ClusterID:     "cluster-a",
			Table:         "pods",
			SortField:     "name",
			SortDirection: "asc",
			Limit:         1,
		},
	}
	first := applyTypedTableQuery(rows, query, typedQueryTestAdapter())
	if first.Continue == "" {
		t.Fatal("expected a continue cursor")
	}

	// The cursor encodes the page size, so replaying it with a different limit
	// invalidates it — the frontend resets to a valid first page rather than
	// serving a misaligned window.
	query.Request.Continue = first.Continue
	query.Request.Limit = 2
	changed := applyTypedTableQuery(rows, query, typedQueryTestAdapter())
	if !changed.CursorInvalid {
		t.Fatal("expected a page-size change to invalidate the continue cursor")
	}
}

func TestResourceQueryRequestFromValuesAcceptsCatalogAndTypedListKeys(t *testing.T) {
	values := mapValues(
		"kinds=Pod,Deployment&kind=StatefulSet&namespaces=apps,default&namespace=kube-system&sort=cpu&sortDirection=desc&limit=500&predicate.health=unhealthy&includeMetadata=true",
	)

	request := resourceQueryRequestFromValues("cluster-a", "pods", values, ResourceQueryRequest{
		SortField:     "name",
		SortDirection: "asc",
		Limit:         250,
	})

	if request.ClusterID != "cluster-a" || request.Table != "pods" {
		t.Fatalf("unexpected request identity: %+v", request)
	}
	assertStringSlicesEqual(t, []string{"Deployment", "Pod", "StatefulSet"}, request.Kinds)
	assertStringSlicesEqual(t, []string{"apps", "default", "kube-system"}, request.Namespaces)
	if request.SortField != "cpu" || request.SortDirection != "desc" || request.Limit != 500 {
		t.Fatalf("unexpected sort/limit: %+v", request)
	}
	if got := resourceQueryPredicatesToMap(request.Predicates)["health"]; got != "unhealthy" {
		t.Fatalf("expected health predicate, got %q", got)
	}
	if !request.IncludeMetadata {
		t.Fatal("expected includeMetadata=true to parse into request.IncludeMetadata")
	}
}

func TestTypedTableQueryResourceIssuesHonorRequestedKinds(t *testing.T) {
	query := typedTableQuery{
		Enabled: true,
		Request: ResourceQueryRequest{
			Kinds: []string{"Secret"},
		},
	}
	issues := typedTableQueryResourceIssues(context.Background(), "namespace-config", query, []typedTableResourceSource{
		{Kind: "ConfigMap", Group: "", Resource: "configmaps", Available: false},
		{Kind: "Secret", Group: "", Resource: "secrets", Available: true},
	})
	if len(issues) != 0 {
		t.Fatalf("expected unavailable unrequested source to be ignored, got %+v", issues)
	}

	query.Request.Kinds = []string{"Deployment"}
	issues = typedTableQueryResourceIssues(context.Background(), "namespace-workloads", query, []typedTableResourceSource{
		{
			Kind:       "Pod",
			Group:      "",
			Resource:   "pods",
			Available:  false,
			QueryKinds: []string{"Pod", "Deployment"},
		},
	})
	if len(issues) != 1 || issues[0].Kind != "Pod" {
		t.Fatalf("expected dependent pod source issue, got %+v", issues)
	}
}

func mapValues(raw string) map[string][]string {
	values, err := url.ParseQuery(raw)
	if err != nil {
		panic(err)
	}
	return values
}

func assertStringSlicesEqual(t *testing.T, want, got []string) {
	t.Helper()
	if len(want) != len(got) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if want[i] != got[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}

// Cursor tokens must survive surrounding whitespace like the catalog codec's do
// (the two codecs had silently diverged on this).
func TestTypedTableQueryCursorDecodeTrimsWhitespace(t *testing.T) {
	token := encodeTypedTableQueryCursor(typedTableQueryCursor{
		ClusterID: "cluster-a",
		Table:     "pods",
		LastKey:   "default/a",
	})
	cursor, ok := decodeTypedTableQueryCursor("  " + token + "\n")
	if !ok {
		t.Fatal("expected a padded cursor token to decode")
	}
	if cursor.LastKey != "default/a" {
		t.Fatalf("expected decoded cursor to round-trip, got %+v", cursor)
	}
}

// A sort request the table cannot honor must SURFACE (the adapters fall back to
// name order, which previously rendered under the requested column's lit arrow
// with no signal). The published SortableFields capability is the contract.
func TestTypedQueryEnvelopeFlagsUnsupportedSortField(t *testing.T) {
	capabilities := newTypedResourceCapabilities(
		[]string{"name", "age"},
		nil,
		[]string{"name"},
		nil,
	)
	rows := []typedQueryTestRow{
		{key: "default/a", name: "a", namespace: "default", kind: "Pod"},
		{key: "default/b", name: "b", namespace: "default", kind: "Pod"},
	}
	queryFor := func(sortField string) typedTableQuery {
		return typedTableQuery{
			Enabled: true,
			Request: ResourceQueryRequest{
				ClusterID:     "cluster-a",
				Table:         "pods",
				SortField:     sortField,
				SortDirection: "asc",
				Limit:         10,
			},
		}
	}

	unsupported := typedQueryEnvelope(
		"pods",
		applyTypedTableQuery(rows, queryFor("bogus"), typedQueryTestAdapter()),
		capabilities,
	)
	if len(unsupported.Issues) == 0 {
		t.Fatal("expected an issue for an unsupported sort field")
	}
	if !strings.Contains(unsupported.Issues[0].Message, "bogus") {
		t.Fatalf("expected the issue to name the field, got %q", unsupported.Issues[0].Message)
	}

	supported := typedQueryEnvelope(
		"pods",
		applyTypedTableQuery(rows, queryFor("name"), typedQueryTestAdapter()),
		capabilities,
	)
	if len(supported.Issues) != 0 {
		t.Fatalf("expected no issues for a supported sort field, got %+v", supported.Issues)
	}
}

func typedQueryTestAdapter() typedTableQueryAdapter[typedQueryTestRow] {
	return typedTableQueryAdapter[typedQueryTestRow]{
		Key:        func(row typedQueryTestRow) string { return row.key },
		Namespace:  func(row typedQueryTestRow) string { return row.namespace },
		Kind:       func(row typedQueryTestRow) string { return row.kind },
		SearchText: func(row typedQueryTestRow) []string { return []string{row.name} },
		Predicate:  func(typedQueryTestRow, string, string) bool { return true },
		SortValue:  func(row typedQueryTestRow, _ string) string { return row.name },
		NumericSort: func(row typedQueryTestRow, field string) (float64, bool) {
			if field == "cpu" {
				return row.cpu, true
			}
			return 0, false
		},
	}
}
