package snapshot

import (
	"context"
	"net/url"
	"testing"
)

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

	collector := newTypedTableQueryCollector(query, typedQueryTestAdapter())
	for _, row := range rows {
		collector.Add(row)
	}
	collectorPage := collector.Page()
	if collectorPage.CursorInvalid {
		t.Fatal("expected bounded collector to keep dynamic cursor valid")
	}
	if len(collectorPage.Rows) != 1 || collectorPage.Rows[0].key != "default/b" {
		t.Fatalf("expected bounded collector second row after dynamic revision change, got %+v", collectorPage.Rows)
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
		"kinds=Pod,Deployment&kind=StatefulSet&namespaces=apps,default&namespace=kube-system&sort=cpu&sortDirection=desc&limit=500&predicate.health=unhealthy",
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
