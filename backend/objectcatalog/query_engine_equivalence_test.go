/*
 * backend/objectcatalog/query_engine_equivalence_test.go
 *
 * THE EQUIVALENCE GATE for the querypage-engine cutover. It proves queryViaEngine
 * returns the same QueryResult as the legacy chunk-scan executor (Service.Query via
 * executeCached) fed the SAME published state, across a matrix of sorts × directions ×
 * filter shapes × full forward AND backward pagination. The cutover (pointing
 * Service.Query at the engine) is only safe while this passes.
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

// assertResultsEquivalent checks the load-bearing fields of two QueryResults match.
func assertResultsEquivalent(t *testing.T, label string, old, got QueryResult) {
	t.Helper()
	if oldUIDs, gotUIDs := pageUIDs(old.Items), pageUIDs(got.Items); !equalStrings(oldUIDs, gotUIDs) {
		t.Fatalf("%s: page items differ\n old=%v\n new=%v", label, oldUIDs, gotUIDs)
	}
	if old.TotalItems != got.TotalItems {
		t.Fatalf("%s: TotalItems differ old=%d new=%d", label, old.TotalItems, got.TotalItems)
	}
	if old.UnfilteredTotal != got.UnfilteredTotal {
		t.Fatalf("%s: UnfilteredTotal differ old=%d new=%d", label, old.UnfilteredTotal, got.UnfilteredTotal)
	}
	if old.TotalIsExact != got.TotalIsExact {
		t.Fatalf("%s: TotalIsExact differ old=%t new=%t", label, old.TotalIsExact, got.TotalIsExact)
	}
	if old.FacetsExact != got.FacetsExact {
		t.Fatalf("%s: FacetsExact differ old=%t new=%t", label, old.FacetsExact, got.FacetsExact)
	}
	if old.CursorInvalid != got.CursorInvalid {
		t.Fatalf("%s: CursorInvalid differ old=%t new=%t", label, old.CursorInvalid, got.CursorInvalid)
	}
	if !equalStrings(kindInfoKey(old.Kinds), kindInfoKey(got.Kinds)) {
		t.Fatalf("%s: Kinds facet differ\n old=%v\n new=%v", label, kindInfoKey(old.Kinds), kindInfoKey(got.Kinds))
	}
	oldNs := append([]string(nil), old.Namespaces...)
	gotNs := append([]string(nil), got.Namespaces...)
	sort.Strings(oldNs)
	sort.Strings(gotNs)
	if !equalStrings(oldNs, gotNs) {
		t.Fatalf("%s: Namespaces facet differ\n old=%v\n new=%v", label, oldNs, gotNs)
	}
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

// TestQueryViaEngineEquivalentToChunkScan is the gate. For every sort × direction ×
// filter shape it walks the full result forward via ContinueToken and backward via
// PreviousToken, asserting the engine result equals the legacy chunk-scan result at
// every page.
func TestQueryViaEngineEquivalentToChunkScan(t *testing.T) {
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
				assertPaginationEquivalent(t, svc, base, label)
			}
		}
	}
}

// assertPaginationEquivalent walks forward to the end collecting every page, then
// walks back to the start via PreviousToken, asserting each page matches the legacy
// path.
func assertPaginationEquivalent(t *testing.T, svc *Service, base QueryOptions, label string) {
	t.Helper()

	// Forward. Each path is driven with ITS OWN continue token (the two codecs differ
	// while both paths coexist), and the resulting page N is compared positionally.
	// Per-page tokens are recorded indexed by page number so the backward walk can
	// drive each path with the exact PreviousToken that page returned.
	oldToken, engineToken := "", ""
	oldPrevTokens := []string{}    // oldPrevTokens[page]    = page's legacy PreviousToken
	enginePrevTokens := []string{} // enginePrevTokens[page] = page's engine PreviousToken
	enginePages := [][]string{}
	for page := 0; page < 100; page++ {
		oldOpts := base
		oldOpts.Continue = oldToken
		old := svc.Query(oldOpts)

		engineOpts := base
		engineOpts.Continue = engineToken
		got, ok := svc.queryViaEngine(engineOpts)
		if !ok {
			t.Fatalf("%s page %d: queryViaEngine returned not-ok", label, page)
		}
		assertResultsEquivalent(t, label+" fwd#"+itoa(page), old, got)

		enginePages = append(enginePages, pageUIDs(got.Items))
		oldPrevTokens = append(oldPrevTokens, old.PreviousToken)
		enginePrevTokens = append(enginePrevTokens, got.PreviousToken)
		if (old.ContinueToken == "") != (got.ContinueToken == "") {
			t.Fatalf("%s fwd#%d: ContinueToken presence differs old=%q new=%q",
				label, page, old.ContinueToken, got.ContinueToken)
		}
		if old.ContinueToken == "" {
			break
		}
		oldToken = old.ContinueToken
		engineToken = got.ContinueToken
	}

	// Backward: page back from the last page via each path's own PreviousToken and
	// assert the legacy prev page equals the engine prev page positionally, AND that
	// the engine's prev page reproduces the forward page recorded on the way out.
	for page := len(enginePrevTokens) - 1; page > 0; page-- {
		oldPrev := oldPrevTokens[page]
		enginePrev := enginePrevTokens[page]
		if (oldPrev == "") != (enginePrev == "") {
			t.Fatalf("%s prev#%d: PreviousToken presence differs old=%q new=%q",
				label, page, oldPrev, enginePrev)
		}
		if enginePrev == "" {
			continue
		}
		oldOpts := base
		oldOpts.Continue = oldPrev
		oldResult := svc.Query(oldOpts)

		engineOpts := base
		engineOpts.Continue = enginePrev
		gotResult, ok := svc.queryViaEngine(engineOpts)
		if !ok {
			t.Fatalf("%s prev#%d: queryViaEngine returned not-ok", label, page)
		}
		assertResultsEquivalent(t, label+" prev#"+itoa(page), oldResult, gotResult)
		if !equalStrings(enginePages[page-1], pageUIDs(gotResult.Items)) {
			t.Fatalf("%s eng-prev#%d: backward page != forward page\n fwd=%v\n back=%v",
				label, page, enginePages[page-1], pageUIDs(gotResult.Items))
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
