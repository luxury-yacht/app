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
		Key:         func(row typedQueryTestRow) string { return row.key },
		Namespace:   func(row typedQueryTestRow) string { return row.namespace },
		Kind:        func(row typedQueryTestRow) string { return row.kind },
		SearchText:  func(row typedQueryTestRow) []string { return []string{row.name} },
		Predicate:   func(typedQueryTestRow, string, string) bool { return true },
		SortValue:   func(row typedQueryTestRow, _ string) string { return row.name },
		NumericSort: func(typedQueryTestRow, string) (float64, bool) { return 0, false },
	}
}
