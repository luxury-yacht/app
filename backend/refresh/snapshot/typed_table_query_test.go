package snapshot

import "testing"

type typedQueryTestRow struct {
	key       string
	name      string
	namespace string
	kind      string
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

func typedQueryTestAdapter() typedTableQueryAdapter[typedQueryTestRow] {
	return typedTableQueryAdapter[typedQueryTestRow]{
		Key:         func(row typedQueryTestRow) string { return row.key },
		Namespace:   func(row typedQueryTestRow) string { return row.namespace },
		Kind:        func(row typedQueryTestRow) string { return row.kind },
		SearchText:  func(row typedQueryTestRow) []string { return []string{row.name} },
		Predicate:   func(typedQueryTestRow, string, string) bool { return true },
		SortValue:   func(row typedQueryTestRow, _ string) string { return row.name },
		NumericSort: func(typedQueryTestRow, string) (float64, bool) { return 0, false },
	}
}
