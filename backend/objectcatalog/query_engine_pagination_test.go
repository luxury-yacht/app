/*
 * backend/objectcatalog/query_engine_pagination_test.go
 *
 * Pagination + facet correctness for the querypage-engine catalog serve. The cutover
 * is complete (Service.Query routes through queryViaEngine; the legacy chunk-scan
 * executor it was equivalence-gated against is deleted), so this exercises the ONE
 * serve path across a matrix of sorts × directions × filter shapes, asserting forward
 * pagination is complete (every matching row exactly once) and backward pagination via
 * PreviousToken reproduces the forward pages exactly, with stable totals and facets.
 */

package objectcatalog

import (
	"sort"
	"testing"
)

// equivalenceSummaries returns a varied catalog: several kinds and groups (built-in
// and custom/CRD), multiple namespaces, cluster-scoped objects, and ties on every
// sort field (same kind, same namespace, same name across kinds, same creation
// timestamp) so the identity-chain tiebreak is exercised.
func equivalenceSummaries() []Summary {
	return []Summary{
		// Built-in namespaced kinds with ties.
		{Kind: "Pod", Group: "", Version: "v1", Resource: "pods", Namespace: "default", Name: "alpha", UID: "uid-pod-1", CreationTimestamp: "2024-01-01T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "Pod", Group: "", Version: "v1", Resource: "pods", Namespace: "default", Name: "beta", UID: "uid-pod-2", CreationTimestamp: "2024-01-02T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "Pod", Group: "", Version: "v1", Resource: "pods", Namespace: "kube-system", Name: "alpha", UID: "uid-pod-3", CreationTimestamp: "2024-01-01T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "Pod", Group: "", Version: "v1", Resource: "pods", Namespace: "kube-system", Name: "gamma", UID: "uid-pod-4", CreationTimestamp: "2024-01-03T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "Service", Group: "", Version: "v1", Resource: "services", Namespace: "default", Name: "alpha", UID: "uid-svc-1", CreationTimestamp: "2024-01-02T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "Service", Group: "", Version: "v1", Resource: "services", Namespace: "app", Name: "frontend", UID: "uid-svc-2", CreationTimestamp: "2024-01-05T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "Deployment", Group: "apps", Version: "v1", Resource: "deployments", Namespace: "default", Name: "web", UID: "uid-dep-1", CreationTimestamp: "2024-01-04T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "Deployment", Group: "apps", Version: "v1", Resource: "deployments", Namespace: "app", Name: "web", UID: "uid-dep-2", CreationTimestamp: "2024-01-04T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "ConfigMap", Group: "", Version: "v1", Resource: "configmaps", Namespace: "app", Name: "settings", UID: "uid-cm-1", CreationTimestamp: "2024-01-06T00:00:00Z", Scope: ScopeNamespace},
		// Built-in cluster-scoped kinds.
		{Kind: "Node", Group: "", Version: "v1", Resource: "nodes", Name: "node-a", UID: "uid-node-1", CreationTimestamp: "2023-12-01T00:00:00Z", Scope: ScopeCluster},
		{Kind: "Node", Group: "", Version: "v1", Resource: "nodes", Name: "node-b", UID: "uid-node-2", CreationTimestamp: "2023-12-02T00:00:00Z", Scope: ScopeCluster},
		{Kind: "Namespace", Group: "", Version: "v1", Resource: "namespaces", Name: "default", UID: "uid-ns-1", CreationTimestamp: "2023-11-01T00:00:00Z", Scope: ScopeCluster},
		// Custom/CRD kinds (namespaced + cluster-scoped) — not in the builtin catalog.
		{Kind: "Widget", Group: "example.com", Version: "v1", Resource: "widgets", Namespace: "default", Name: "alpha", UID: "uid-w-1", CreationTimestamp: "2024-02-01T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "Widget", Group: "example.com", Version: "v1", Resource: "widgets", Namespace: "app", Name: "alpha", UID: "uid-w-2", CreationTimestamp: "2024-02-01T00:00:00Z", Scope: ScopeNamespace},
		{Kind: "ClusterWidget", Group: "example.com", Version: "v1", Resource: "clusterwidgets", Name: "global", UID: "uid-cw-1", CreationTimestamp: "2024-02-02T00:00:00Z", Scope: ScopeCluster},
	}
}

// newEquivalenceService publishes the varied catalog as a single chunk so both the
// chunk-scan executor and the maintained engine store see the same state.
func newEquivalenceService(t *testing.T, items []Summary) *Service {
	t.Helper()
	svc := NewService(Dependencies{}, nil)

	kindSet := make(map[string]bool)
	namespaceSet := make(map[string]struct{})
	descriptorSet := make(map[string]Descriptor)
	for _, item := range items {
		if item.Kind != "" {
			kindSet[item.Kind] = item.Scope == ScopeNamespace
		}
		if item.Namespace != "" {
			namespaceSet[item.Namespace] = struct{}{}
		}
		key := item.Group + "/" + item.Version + "/" + item.Resource
		descriptorSet[key] = Descriptor{
			Group: item.Group, Version: item.Version, Resource: item.Resource,
			Kind: item.Kind, Scope: item.Scope, Namespaced: item.Scope == ScopeNamespace,
		}
	}
	descriptors := make([]Descriptor, 0, len(descriptorSet))
	for _, d := range descriptorSet {
		descriptors = append(descriptors, d)
	}

	svc.publishStreamingState([]*summaryChunk{{items: items}}, kindSet, namespaceSet, descriptors, true)
	return svc
}

// sortedUIDs returns the engine-UID identity of each item, in slice order — the order
// the page returned them.
func pageUIDs(items []Summary) []string {
	uids := make([]string, len(items))
	for i, item := range items {
		uids[i] = catalogEngineUID(item)
	}
	return uids
}

func kindInfoKey(infos []KindInfo) []string {
	keys := make([]string, 0, len(infos))
	for _, info := range infos {
		keys = append(keys, info.Kind)
	}
	sort.Strings(keys)
	return keys
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestCatalogQueryPaginationComplete exercises the single engine serve across the full
// matrix of sorts × directions × filter shapes. For each it asserts forward pagination
// visits every matching row exactly once (== TotalItems, no duplicates) and backward
// pagination via PreviousToken reproduces the forward pages exactly, with the totals
// and facet sets stable across every page.
func TestCatalogQueryPaginationComplete(t *testing.T) {
	svc := newEquivalenceService(t, equivalenceSummaries())

	sorts := []struct {
		field string
		dir   string
	}{
		{"", "asc"}, {"", "desc"},
		{"kind", "asc"}, {"kind", "desc"},
		{"namespace", "asc"}, {"namespace", "desc"},
		{"name", "asc"}, {"name", "desc"},
		{"age", "asc"}, {"age", "desc"},
		{"creationtimestamp", "asc"}, {"creationtimestamp", "desc"},
	}

	filterShapes := []struct {
		name string
		opts QueryOptions
	}{
		{"no-filter", QueryOptions{}},
		{"kind-filter", QueryOptions{Kinds: []string{"Pod"}}},
		{"multi-kind-filter", QueryOptions{Kinds: []string{"Pod", "Service"}}},
		{"namespace-filter", QueryOptions{Namespaces: []string{"default"}}},
		{"namespace-cluster-filter", QueryOptions{Namespaces: []string{"cluster"}}},
		{"namespace-and-kind", QueryOptions{Namespaces: []string{"default"}, Kinds: []string{"Pod"}}},
		{"search", QueryOptions{Search: "alpha"}},
		{"custom-only", QueryOptions{CustomOnly: true}},
		{"custom-only-with-search", QueryOptions{CustomOnly: true, Search: "alpha"}},
	}

	for _, s := range sorts {
		for _, shape := range filterShapes {
			for _, limit := range []int{2, 5} {
				base := shape.opts
				base.SortField = s.field
				base.SortDirection = s.dir
				base.Limit = limit
				label := s.field + "/" + s.dir + "/" + shape.name + "/limit=" + itoa(limit)
				assertPaginationComplete(t, svc, base, label)
			}
		}
	}
}

// assertPaginationComplete walks forward to the end recording every page, asserting
// the run is complete (every matching row once, in a stable order, count == TotalItems)
// with stable totals/facets, then walks back via PreviousToken and asserts each prev
// page reproduces the forward page exactly.
func assertPaginationComplete(t *testing.T, svc *Service, base QueryOptions, label string) {
	t.Helper()

	token := ""
	prevTokens := []string{}  // prevTokens[page] = that page's PreviousToken
	pages := [][]string{}     // pages[page]      = that page's row UIDs
	seen := map[string]bool{} // every UID across the whole run (dup detection)
	wantTotal, wantKinds, wantNs := -1, []string(nil), []string(nil)
	collected := 0

	for page := 0; page < 100; page++ {
		opts := base
		opts.Continue = token
		result := svc.Query(opts)

		// Totals and facet sets are a property of the query, not the page, so they
		// must be identical on every page of the run.
		kinds := kindInfoKey(result.Kinds)
		ns := append([]string(nil), result.Namespaces...)
		sort.Strings(ns)
		if page == 0 {
			wantTotal, wantKinds, wantNs = result.TotalItems, kinds, ns
		} else {
			if result.TotalItems != wantTotal {
				t.Fatalf("%s page %d: TotalItems drifted %d -> %d", label, page, wantTotal, result.TotalItems)
			}
			if !equalStrings(kinds, wantKinds) {
				t.Fatalf("%s page %d: Kinds facet drifted\n want=%v\n got=%v", label, page, wantKinds, kinds)
			}
			if !equalStrings(ns, wantNs) {
				t.Fatalf("%s page %d: Namespaces facet drifted\n want=%v\n got=%v", label, page, wantNs, ns)
			}
		}

		uids := pageUIDs(result.Items)
		for _, uid := range uids {
			if seen[uid] {
				t.Fatalf("%s page %d: row %q returned on more than one page", label, page, uid)
			}
			seen[uid] = true
		}
		if len(uids) > base.Limit {
			t.Fatalf("%s page %d: page size %d exceeds limit %d", label, page, len(uids), base.Limit)
		}
		collected += len(uids)
		pages = append(pages, uids)
		prevTokens = append(prevTokens, result.PreviousToken)

		if result.ContinueToken == "" {
			break
		}
		token = result.ContinueToken
	}

	if collected != wantTotal {
		t.Fatalf("%s: forward pagination returned %d rows, TotalItems=%d", label, collected, wantTotal)
	}

	// Backward: each non-first page's PreviousToken must reproduce the page before it.
	for page := len(prevTokens) - 1; page > 0; page-- {
		prev := prevTokens[page]
		if prev == "" {
			t.Fatalf("%s prev#%d: expected a PreviousToken on a non-first page", label, page)
		}
		opts := base
		opts.Continue = prev
		result := svc.Query(opts)
		if got := pageUIDs(result.Items); !equalStrings(pages[page-1], got) {
			t.Fatalf("%s prev#%d: backward page != forward page\n fwd=%v\n back=%v",
				label, page, pages[page-1], got)
		}
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
