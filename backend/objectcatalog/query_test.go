/*
 * backend/objectcatalog/query_test.go
 *
 * Catalog query and streaming-driven query tests.
 */

package objectcatalog

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type fakeCatalogQueryStore struct {
	result QueryResult
	ok     bool
	seen   []QueryOptions
}

func (store *fakeCatalogQueryStore) QueryCatalog(opts QueryOptions) (QueryResult, bool) {
	store.seen = append(store.seen, opts)
	return store.result, store.ok
}

func TestServiceQueryUsesCatalogQueryStoreContract(t *testing.T) {
	store := &fakeCatalogQueryStore{
		ok: true,
		result: QueryResult{
			Items: []Summary{{
				Kind:     "Node",
				Version:  "v1",
				Resource: "nodes",
				Name:     "node-a",
				UID:      "node-a",
				Scope:    ScopeCluster,
			}},
			TotalItems:   1,
			TotalIsExact: true,
			FacetsExact:  true,
		},
	}
	svc := NewService(Dependencies{}, &Options{QueryStore: store})

	result := svc.Query(QueryOptions{Limit: 10, Search: "node"})

	if len(store.seen) != 1 || store.seen[0].Search != "node" {
		t.Fatalf("expected query options to pass through store, got %+v", store.seen)
	}
	if len(result.Items) != 1 || result.Items[0].Name != "node-a" || result.TotalItems != 1 {
		t.Fatalf("unexpected store-backed query result: %+v", result)
	}
}

func TestQueryFiltersAndPublishesAPIGroupAndResourceScopeFacets(t *testing.T) {
	svc := NewService(Dependencies{ClusterID: "cluster-a"}, nil)
	svc.items = map[string]Summary{
		"pod": {
			ClusterID: "cluster-a", Kind: "Pod", Group: "", Version: "v1", Resource: "pods",
			Namespace: "default", Name: "pod-a", UID: "uid-pod", Scope: ScopeNamespace,
		},
		"deployment-a": {
			ClusterID: "cluster-a", Kind: "Deployment", Group: "apps", Version: "v1", Resource: "deployments",
			Namespace: "default", Name: "deployment-a", UID: "uid-deployment-a", Scope: ScopeNamespace,
		},
		"deployment-b": {
			ClusterID: "cluster-a", Kind: "Deployment", Group: "apps", Version: "v1", Resource: "deployments",
			Namespace: "team-a", Name: "deployment-b", UID: "uid-deployment-b", Scope: ScopeNamespace,
		},
		"node": {
			ClusterID: "cluster-a", Kind: "Node", Group: "", Version: "v1", Resource: "nodes",
			Name: "node-a", UID: "uid-node", Scope: ScopeCluster,
		},
		"crd": {
			ClusterID: "cluster-a", Kind: "CustomResourceDefinition", Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions",
			Name: "widgets.example.com", UID: "uid-crd", Scope: ScopeCluster,
		},
	}

	result := svc.Query(QueryOptions{
		Limit:          1,
		Groups:         []string{"apps"},
		ResourceScopes: []Scope{ScopeNamespace},
	})

	if result.TotalItems != 2 || result.UnfilteredTotal != 5 {
		t.Fatalf("expected API-group/scope filtering to return 2 of 5 rows, got %d of %d", result.TotalItems, result.UnfilteredTotal)
	}
	if len(result.Items) != 1 || result.Items[0].Group != "apps" || result.Items[0].Scope != ScopeNamespace {
		t.Fatalf("unexpected filtered page: %+v", result.Items)
	}
	if !reflect.DeepEqual(result.Groups, []string{"(core)", "apiextensions.k8s.io", "apps"}) {
		t.Fatalf("unexpected API-group facets: %+v", result.Groups)
	}
	if !reflect.DeepEqual(result.ResourceScopes, []Scope{ScopeCluster, ScopeNamespace}) {
		t.Fatalf("unexpected resource-scope facets: %+v", result.ResourceScopes)
	}
	if !reflect.DeepEqual(result.Kinds, []KindInfo{{Kind: "Deployment", Namespaced: true}}) {
		t.Fatalf("expected selected API groups to constrain Kinds, got %+v", result.Kinds)
	}
	if result.ContinueToken == "" {
		t.Fatal("expected a cursor for the second apps row")
	}

	reusedAcrossGroup := svc.Query(QueryOptions{
		Limit:          1,
		Groups:         []string{"(core)"},
		ResourceScopes: []Scope{ScopeNamespace},
		Continue:       result.ContinueToken,
	})
	if !reusedAcrossGroup.CursorInvalid {
		t.Fatal("expected a cursor minted for one API-group filter to be rejected by another")
	}

	namespaceOnly := svc.Query(QueryOptions{Scope: ScopeNamespace, Limit: 10})
	if !reflect.DeepEqual(namespaceOnly.Groups, []string{"(core)", "apps"}) {
		t.Fatalf("expected API-group facets to retain the structural namespace boundary, got %+v", namespaceOnly.Groups)
	}
	if !reflect.DeepEqual(namespaceOnly.ResourceScopes, []Scope{ScopeNamespace}) {
		t.Fatalf("expected resource-scope facets to retain the structural namespace boundary, got %+v", namespaceOnly.ResourceScopes)
	}
}

func TestServiceQueryStreamsWithoutFullCache(t *testing.T) {
	svc := NewService(Dependencies{}, nil)

	chunk := &summaryChunk{
		items: []Summary{
			{
				Kind:      "Pod",
				Group:     "",
				Version:   "v1",
				Resource:  "pods",
				Namespace: "default",
				Name:      "demo-pod",
				UID:       "uid-1",
				Scope:     ScopeNamespace,
			},
			{
				Kind:      "Pod",
				Group:     "",
				Version:   "v1",
				Resource:  "pods",
				Namespace: "kube-system",
				Name:      "controller",
				UID:       "uid-2",
				Scope:     ScopeNamespace,
			},
		},
	}

	kindSet := map[string]bool{"Pod": true} // true = namespaced
	namespaceSet := map[string]struct{}{"default": {}, "kube-system": {}}
	descriptors := []Descriptor{
		{Group: "", Version: "v1", Resource: "pods", Kind: "Pod", Scope: ScopeNamespace, Namespaced: true},
	}

	svc.publishStreamingState([]*summaryChunk{chunk}, kindSet, namespaceSet, descriptors, false)

	result := svc.Query(QueryOptions{Limit: 1})
	if len(result.Items) != 1 {
		t.Fatalf("expected first page with 1 item, got %d", len(result.Items))
	}
	if result.Items[0].Name != "demo-pod" {
		t.Fatalf("expected first item demo-pod, got %s", result.Items[0].Name)
	}
	if result.TotalItems != 2 {
		t.Fatalf("expected total matches 2, got %d", result.TotalItems)
	}
	if result.ContinueToken == "" {
		t.Fatalf("expected continue token")
	}

	next := svc.Query(QueryOptions{Limit: 1, Continue: result.ContinueToken})
	if len(next.Items) != 1 || next.Items[0].Name != "controller" {
		t.Fatalf("expected second page to contain controller, got %+v", next.Items)
	}
	if next.ContinueToken != "" {
		t.Fatalf("expected no further pages, got %q", next.ContinueToken)
	}
}

// The query index is built lazily on the first query after a publish; a later
// publish must invalidate the memoized index so queries never serve stale
// results.
func TestServiceQueryIndexRebuiltAfterLaterPublish(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	podSummary := func(name string) Summary {
		return Summary{
			Kind: "Pod", Version: "v1", Resource: "pods",
			Namespace: "default", Name: name, UID: "uid-" + name, Scope: ScopeNamespace,
		}
	}
	kindSet := map[string]bool{"Pod": true}
	namespaceSet := map[string]struct{}{"default": {}}

	svc.publishStreamingState(
		[]*summaryChunk{{items: []Summary{podSummary("alpha")}}},
		kindSet, namespaceSet, nil, true,
	)
	first := svc.Query(QueryOptions{Limit: 10, Namespaces: []string{"default"}})
	if len(first.Items) != 1 {
		t.Fatalf("expected one item before the second publish, got %d", len(first.Items))
	}

	svc.publishStreamingState(
		[]*summaryChunk{{items: []Summary{podSummary("alpha"), podSummary("beta")}}},
		kindSet, namespaceSet, nil, true,
	)
	second := svc.Query(QueryOptions{Limit: 10, Namespaces: []string{"default"}})
	if len(second.Items) != 2 {
		t.Fatalf("expected the rebuilt index to surface both items, got %d", len(second.Items))
	}
}

// The snapshot serve path (no chunks published) must report the unfiltered scope
// total like the maintained-store path does, or the "showing N of M" banner reads
// "N of 0".
func TestQueryFromSnapshotReportsUnfilteredTotal(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	// Populate items WITHOUT publishing chunks: the engine store is empty, so Query
	// serves from the items-map snapshot (queryViaEngineFromSnapshot).
	svc.items = map[string]Summary{
		"a": {Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "alpha", UID: "uid-a", Scope: ScopeNamespace},
		"b": {Kind: "Service", Version: "v1", Resource: "services", Namespace: "default", Name: "bravo", UID: "uid-b", Scope: ScopeNamespace},
	}

	result := svc.Query(QueryOptions{Limit: 10, Kinds: []string{"Pod"}})
	if result.TotalItems != 1 {
		t.Fatalf("expected one filtered match, got %d", result.TotalItems)
	}
	if result.UnfilteredTotal != 2 {
		t.Fatalf("expected the unfiltered scope total (2), got %d", result.UnfilteredTotal)
	}
}

func TestQueryNoMatchKindFilterReturnsEmptyResult(t *testing.T) {
	pod := Summary{
		ClusterID: "cluster-a",
		Kind:      "Pod",
		Group:     "",
		Version:   "v1",
		Resource:  "pods",
		Namespace: "default",
		Name:      "alpha",
		UID:       "uid-alpha",
		Scope:     ScopeNamespace,
	}
	service := Summary{
		ClusterID: "cluster-a",
		Kind:      "Service",
		Group:     "",
		Version:   "v1",
		Resource:  "services",
		Namespace: "default",
		Name:      "bravo",
		UID:       "uid-bravo",
		Scope:     ScopeNamespace,
	}

	for _, tc := range []struct {
		name string
		svc  *Service
	}{
		{
			name: "published chunks",
			svc: func() *Service {
				svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
				svc.publishStreamingState(
					[]*summaryChunk{{items: []Summary{pod, service}}},
					map[string]bool{"Pod": true, "Service": true},
					map[string]struct{}{"default": {}},
					[]Descriptor{
						{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ScopeNamespace, Namespaced: true},
						{Version: "v1", Resource: "services", Kind: "Service", Scope: ScopeNamespace, Namespaced: true},
					},
					true,
				)
				return svc
			}(),
		},
		{
			name: "snapshot items",
			svc: func() *Service {
				podDesc := resourceDescriptor{
					GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
					Namespaced: true,
					Kind:       "Pod",
					Group:      "",
					Version:    "v1",
					Resource:   "pods",
					Scope:      ScopeNamespace,
				}
				serviceDesc := resourceDescriptor{
					GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"},
					Namespaced: true,
					Kind:       "Service",
					Group:      "",
					Version:    "v1",
					Resource:   "services",
					Scope:      ScopeNamespace,
				}
				svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
				svc.items = map[string]Summary{
					catalogKey(podDesc, pod.Namespace, pod.Name):             pod,
					catalogKey(serviceDesc, service.Namespace, service.Name): service,
				}
				svc.resources = map[string]resourceDescriptor{
					podDesc.GVR.String():     podDesc,
					serviceDesc.GVR.String(): serviceDesc,
				}
				return svc
			}(),
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := tc.svc.Query(QueryOptions{Limit: 10, Kinds: []string{"DoesNotExist"}})
			if result.TotalItems != 0 || len(result.Items) != 0 {
				t.Fatalf("expected no rows for unmatched kind filter, got total=%d items=%+v", result.TotalItems, result.Items)
			}
			if result.UnfilteredTotal != 2 {
				t.Fatalf("expected unfiltered scope total to remain 2, got %d", result.UnfilteredTotal)
			}
		})
	}
}

// A previous-page cursor whose predecessors were all deleted must report
// cursorInvalid so the UI resets to page 1 instead of rendering a dead-end
// empty page with no tokens.
func TestCatalogPreviousPageWithDeletedPredecessorsInvalidatesCursor(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	summary := func(name string) Summary {
		return Summary{
			Kind: "Pod", Version: "v1", Resource: "pods",
			Namespace: "default", Name: name, UID: "uid-" + name, Scope: ScopeNamespace,
		}
	}
	publish := func(items []Summary) {
		svc.publishStreamingState(
			[]*summaryChunk{{items: items}},
			map[string]bool{"Pod": true},
			map[string]struct{}{"default": {}},
			nil,
			true,
		)
	}

	publish([]Summary{summary("alpha"), summary("bravo"), summary("charlie")})

	first := svc.Query(QueryOptions{Limit: 1})
	if first.ContinueToken == "" {
		t.Fatal("expected a continue token on page 1")
	}
	second := svc.Query(QueryOptions{Limit: 1, Continue: first.ContinueToken})
	if second.PreviousToken == "" {
		t.Fatal("expected a previous token on page 2")
	}

	// Everything before the page-2 anchor is deleted.
	publish([]Summary{summary("bravo"), summary("charlie")})

	recovered := svc.Query(QueryOptions{Limit: 1, Continue: second.PreviousToken})
	if !recovered.CursorInvalid {
		t.Fatalf(
			"expected an empty previous page to invalidate the cursor, got items=%d continue=%q previous=%q invalid=%t",
			len(recovered.Items), recovered.ContinueToken, recovered.PreviousToken, recovered.CursorInvalid,
		)
	}
}

// "Age ascending" means newest-first everywhere else in the app (typed tables
// encode age as a negated timestamp); the catalog must match — the identical
// header gesture must not produce opposite chronology in Browse/Custom.
func TestCatalogAgeSortMatchesTypedTableConvention(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	summary := func(name, created string) Summary {
		return Summary{
			Kind: "Pod", Version: "v1", Resource: "pods",
			Namespace: "default", Name: name, UID: "uid-" + name,
			CreationTimestamp: created, Scope: ScopeNamespace,
		}
	}
	svc.publishStreamingState(
		[]*summaryChunk{{items: []Summary{
			summary("old", "2020-01-01T00:00:00Z"),
			summary("new", "2026-01-01T00:00:00Z"),
		}}},
		map[string]bool{"Pod": true},
		map[string]struct{}{"default": {}},
		nil,
		true,
	)

	asc := svc.Query(QueryOptions{Limit: 10, SortField: "age", SortDirection: "asc"})
	if len(asc.Items) != 2 || asc.Items[0].Name != "new" {
		t.Fatalf("expected age ascending to put the newest first, got %+v", asc.Items)
	}

	desc := svc.Query(QueryOptions{Limit: 10, SortField: "age", SortDirection: "desc"})
	if len(desc.Items) != 2 || desc.Items[0].Name != "old" {
		t.Fatalf("expected age descending to put the oldest first, got %+v", desc.Items)
	}
}

func TestQueryReportsUnfilteredScopeTotal(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	chunk := &summaryChunk{
		items: []Summary{
			{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "alpha", UID: "uid-1", Scope: ScopeNamespace},
			{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "beta", UID: "uid-2", Scope: ScopeNamespace},
			{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "kube-system", Name: "gamma", UID: "uid-3", Scope: ScopeNamespace},
		},
	}
	kindSet := map[string]bool{"Pod": true}
	namespaceSet := map[string]struct{}{"default": {}, "kube-system": {}}
	descriptors := []Descriptor{
		{Group: "", Version: "v1", Resource: "pods", Kind: "Pod", Scope: ScopeNamespace, Namespaced: true},
	}
	svc.publishStreamingState([]*summaryChunk{chunk}, kindSet, namespaceSet, descriptors, false)

	// A search narrows to 1 row, but the unfiltered scope total is all 3 ("of M").
	filtered := svc.Query(QueryOptions{Limit: 10, Search: "alpha"})
	if filtered.TotalItems != 1 {
		t.Fatalf("filtered total should be the search match count; got %d, want 1", filtered.TotalItems)
	}
	if filtered.UnfilteredTotal != 3 {
		t.Fatalf("unfiltered total should be the in-scope count before filters; got %d, want 3", filtered.UnfilteredTotal)
	}

	// With no filter, N and M are the same full count.
	all := svc.Query(QueryOptions{Limit: 10})
	if all.TotalItems != 3 || all.UnfilteredTotal != 3 {
		t.Fatalf("with no filter N==M==full count; got total=%d unfiltered=%d", all.TotalItems, all.UnfilteredTotal)
	}
}

func TestQueryUnfilteredTotalStaysInsideStructuralScope(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	chunk := &summaryChunk{items: []Summary{
		{Kind: "APIService", Group: "apiregistration.k8s.io", Version: "v1", Resource: "apiservices", Name: "v1.apps", UID: "uid-1", Scope: ScopeCluster},
		{Kind: "Node", Version: "v1", Resource: "nodes", Name: "node-a", UID: "uid-2", Scope: ScopeCluster},
		{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "pod-a", UID: "uid-3", Scope: ScopeNamespace},
		{Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "kube-system", Name: "pod-b", UID: "uid-4", Scope: ScopeNamespace},
	}}
	svc.publishStreamingState(
		[]*summaryChunk{chunk},
		map[string]bool{"APIService": true, "Node": true, "Pod": true},
		map[string]struct{}{"default": {}, "kube-system": {}},
		nil,
		false,
	)

	result := svc.Query(QueryOptions{
		Scope:      ScopeCluster,
		Namespaces: []string{"cluster"},
		Kinds:      []string{"APIService"},
		Limit:      50,
	})

	if result.TotalItems != 1 {
		t.Fatalf("filtered total should be 1, got %d", result.TotalItems)
	}
	if result.UnfilteredTotal != 2 {
		t.Fatalf("unfiltered total should stay inside the two cluster-scoped objects, got %d", result.UnfilteredTotal)
	}

	namespaceResult := svc.Query(QueryOptions{
		Scope:           ScopeNamespace,
		ScopeNamespaces: []string{"default"},
		Namespaces:      []string{"default"},
		Kinds:           []string{"Pod"},
		Limit:           50,
	})
	if namespaceResult.TotalItems != 1 || namespaceResult.UnfilteredTotal != 1 {
		t.Fatalf("pinned namespace totals should stay 1 of 1, got %d of %d", namespaceResult.TotalItems, namespaceResult.UnfilteredTotal)
	}

	allNamespacesResult := svc.Query(QueryOptions{
		Scope:      ScopeNamespace,
		Namespaces: []string{"default", "kube-system"},
		Search:     "pod-a",
		Limit:      50,
	})
	if allNamespacesResult.TotalItems != 1 || allNamespacesResult.UnfilteredTotal != 2 {
		t.Fatalf("all-namespaces totals should stay 1 of 2 namespaced objects, got %d of %d", allNamespacesResult.TotalItems, allNamespacesResult.UnfilteredTotal)
	}
}

func TestQueryFiltersAndPagination(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)

	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}
	deployDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(podDesc, "default", "pod-a"): {
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "pod-a",
			Scope:     ScopeNamespace,
		},
		catalogKey(podDesc, "kube-system", "pod-b"): {
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "kube-system",
			Name:      "pod-b",
			Scope:     ScopeNamespace,
		},
		catalogKey(deployDesc, "default", "deploy-a"): {
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "default",
			Name:      "deploy-a",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String():    podDesc,
		deployDesc.GVR.String(): deployDesc,
	}
	svc.mu.Unlock()

	result := svc.Query(QueryOptions{
		Kinds:  []string{"Pod"},
		Limit:  1,
		Search: "",
	})

	if result.TotalItems != 2 {
		t.Fatalf("expected 2 pods, got %d", result.TotalItems)
	}
	if len(result.Items) != 1 {
		t.Fatalf("expected first page to return 1 item, got %d", len(result.Items))
	}
	if result.ContinueToken == "" {
		t.Fatalf("expected continue token")
	}
	if result.ResourceCount != 1 {
		t.Fatalf("expected resource count 1 for pod filter, got %d", result.ResourceCount)
	}
	expectedKinds := []KindInfo{{Kind: "Deployment", Namespaced: true}, {Kind: "Pod", Namespaced: true}}
	if !reflect.DeepEqual(result.Kinds, expectedKinds) {
		t.Fatalf("unexpected kinds: %+v", result.Kinds)
	}
	if !reflect.DeepEqual(result.Namespaces, []string{"default", "kube-system"}) {
		t.Fatalf("unexpected namespaces: %+v", result.Namespaces)
	}

	next := svc.Query(QueryOptions{
		Kinds:    []string{"Pod"},
		Limit:    1,
		Continue: result.ContinueToken,
	})
	if len(next.Items) != 1 {
		t.Fatalf("expected second page to return 1 item, got %d", len(next.Items))
	}
	if next.ContinueToken != "" {
		t.Fatalf("expected no further pages, got token %q", next.ContinueToken)
	}
}

func TestQueryCustomOnlyExcludesBuiltins(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)

	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}
	widgetDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
		Namespaced: true,
		Kind:       "Widget",
		Group:      "example.com",
		Version:    "v1",
		Resource:   "widgets",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(podDesc, "default", "pod-a"): {
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "pod-a",
			UID:       "uid-pod",
			Scope:     ScopeNamespace,
		},
		catalogKey(widgetDesc, "default", "widget-a"): {
			ClusterID: "cluster-a",
			Kind:      "Widget",
			Group:     "example.com",
			Version:   "v1",
			Resource:  "widgets",
			Namespace: "default",
			Name:      "widget-a",
			UID:       "uid-widget",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String():    podDesc,
		widgetDesc.GVR.String(): widgetDesc,
	}
	svc.mu.Unlock()

	result := svc.Query(QueryOptions{CustomOnly: true, Limit: 10})
	if result.TotalItems != 1 {
		t.Fatalf("expected one custom resource, got %d", result.TotalItems)
	}
	if len(result.Items) != 1 || result.Items[0].Kind != "Widget" {
		t.Fatalf("unexpected custom-only items: %+v", result.Items)
	}
	if result.ResourceCount != 1 {
		t.Fatalf("expected one custom descriptor, got %d", result.ResourceCount)
	}
	if !reflect.DeepEqual(result.Kinds, []KindInfo{{Kind: "Widget", Namespaced: true}}) {
		t.Fatalf("unexpected custom-only facets: %+v", result.Kinds)
	}
}

func TestQueryKeysetCursorContinuesAcrossLiveInsertBeforeAnchor(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(podDesc, "default", "b"): {
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "b",
			UID:       "uid-b",
			Scope:     ScopeNamespace,
		},
		catalogKey(podDesc, "default", "c"): {
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "c",
			UID:       "uid-c",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	svc.mu.Unlock()

	first := svc.Query(QueryOptions{Limit: 1})
	if len(first.Items) != 1 || first.Items[0].Name != "b" || first.ContinueToken == "" {
		t.Fatalf("unexpected first page: %+v", first)
	}

	svc.mu.Lock()
	svc.items[catalogKey(podDesc, "default", "a")] = Summary{
		ClusterID: "cluster-a",
		Kind:      "Pod",
		Group:     "",
		Version:   "v1",
		Resource:  "pods",
		Namespace: "default",
		Name:      "a",
		UID:       "uid-a",
		Scope:     ScopeNamespace,
	}
	svc.mu.Unlock()

	next := svc.Query(QueryOptions{Limit: 1, Continue: first.ContinueToken})
	if next.CursorInvalid {
		t.Fatalf("expected live insert before anchor to keep cursor valid")
	}
	if len(next.Items) != 1 || next.Items[0].Name != "c" {
		t.Fatalf("expected next page to continue after anchor b, got %+v", next.Items)
	}
}

func TestQueryRejectsIncompatibleCursor(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	result := svc.Query(QueryOptions{Limit: 1, Continue: "not-a-cursor"})
	if !result.CursorInvalid {
		t.Fatalf("expected malformed cursor to be marked invalid")
	}
}

func TestQueryBackendSortsByRequestedFieldAndDirection(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{}
	for _, name := range []string{"alpha", "charlie", "bravo"} {
		svc.items[catalogKey(podDesc, "default", name)] = Summary{
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      name,
			UID:       "uid-" + name,
			Scope:     ScopeNamespace,
		}
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	svc.mu.Unlock()
	svc.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())

	first := svc.Query(QueryOptions{Limit: 2, SortField: "name", SortDirection: "desc"})
	if len(first.Items) != 2 {
		t.Fatalf("expected first page with 2 items, got %+v", first.Items)
	}
	if first.Items[0].Name != "charlie" || first.Items[1].Name != "bravo" {
		t.Fatalf("unexpected first sorted page: %+v", first.Items)
	}
	if first.ContinueToken == "" {
		t.Fatalf("expected continue token")
	}

	next := svc.Query(QueryOptions{
		Limit:         2,
		SortField:     "name",
		SortDirection: "desc",
		Continue:      first.ContinueToken,
	})
	if next.CursorInvalid {
		t.Fatalf("expected compatible sort cursor to remain valid")
	}
	if len(next.Items) != 1 || next.Items[0].Name != "alpha" {
		t.Fatalf("unexpected second sorted page: %+v", next.Items)
	}
}

func TestQueryCachedAndUncachedPathsUseSameOrdering(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{}
	for _, item := range []struct {
		namespace string
		name      string
		created   string
	}{
		{namespace: "team-b", name: "alpha", created: "2026-01-03T00:00:00Z"},
		{namespace: "team-a", name: "charlie", created: "2026-01-01T00:00:00Z"},
		{namespace: "team-a", name: "bravo", created: "2026-01-02T00:00:00Z"},
	} {
		svc.items[catalogKey(podDesc, item.namespace, item.name)] = Summary{
			ClusterID:         "cluster-a",
			Kind:              "Pod",
			Group:             "",
			Version:           "v1",
			Resource:          "pods",
			Namespace:         item.namespace,
			Name:              item.name,
			UID:               "uid-" + item.name,
			CreationTimestamp: item.created,
			Scope:             ScopeNamespace,
		}
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	svc.mu.Unlock()

	opts := QueryOptions{Limit: 3, SortField: "age", SortDirection: "desc"}
	uncached := svc.Query(opts)
	svc.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())
	cached := svc.Query(opts)

	if len(uncached.Items) != len(cached.Items) {
		t.Fatalf("expected same item count, uncached=%+v cached=%+v", uncached.Items, cached.Items)
	}
	for idx := range uncached.Items {
		if uncached.Items[idx].Name != cached.Items[idx].Name {
			t.Fatalf("ordering diverged at %d: uncached=%+v cached=%+v", idx, uncached.Items, cached.Items)
		}
	}
}

func TestQueryUsesGVKAndNamespaceFilterContract(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	deployDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(deployDesc, "team-a", "deploy-a"): {
			ClusterID: "cluster-a",
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "team-a",
			Name:      "deploy-a",
			UID:       "uid-deploy-a",
			Scope:     ScopeNamespace,
		},
		catalogKey(deployDesc, "team-b", "deploy-b"): {
			ClusterID: "cluster-a",
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "team-b",
			Name:      "deploy-b",
			UID:       "uid-deploy-b",
			Scope:     ScopeNamespace,
		},
		catalogKey(podDesc, "team-a", "pod-a"): {
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "team-a",
			Name:      "pod-a",
			UID:       "uid-pod-a",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		deployDesc.GVR.String(): deployDesc,
		podDesc.GVR.String():    podDesc,
	}
	svc.mu.Unlock()
	svc.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())

	result := svc.Query(QueryOptions{
		Kinds:      []string{"apps/v1/Deployment"},
		Namespaces: []string{"team-a"},
		Limit:      10,
	})
	if result.CursorInvalid {
		t.Fatalf("did not expect cursor invalid")
	}
	if result.TotalItems != 1 || len(result.Items) != 1 {
		t.Fatalf("expected one deployment in team-a, got total=%d items=%+v", result.TotalItems, result.Items)
	}
	if item := result.Items[0]; item.Name != "deploy-a" || item.Group != "apps" || item.Version != "v1" || item.Kind != "Deployment" {
		t.Fatalf("unexpected filtered item: %+v", item)
	}
	expectedKinds := []KindInfo{{Kind: "Deployment", Namespaced: true}, {Kind: "Pod", Namespaced: true}}
	if !reflect.DeepEqual(result.Kinds, expectedKinds) {
		t.Fatalf("namespace facets should describe the namespace universe, got %+v", result.Kinds)
	}
}

func TestQueryRejectsCursorFromDifferentCluster(t *testing.T) {
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	source := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	source.mu.Lock()
	source.items = map[string]Summary{
		catalogKey(podDesc, "default", "a"): {
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "a",
			UID:       "uid-a",
			Scope:     ScopeNamespace,
		},
		catalogKey(podDesc, "default", "b"): {
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "b",
			UID:       "uid-b",
			Scope:     ScopeNamespace,
		},
	}
	source.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	source.mu.Unlock()

	first := source.Query(QueryOptions{Limit: 1})
	if first.ContinueToken == "" {
		t.Fatalf("expected source cursor")
	}

	target := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-b"}, nil)
	target.mu.Lock()
	target.items = cloneSummaryMap(source.items)
	target.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	target.mu.Unlock()

	next := target.Query(QueryOptions{Limit: 1, Continue: first.ContinueToken})
	if !next.CursorInvalid {
		t.Fatalf("expected cursor from cluster-a to be invalid on cluster-b")
	}
}

func TestQueryMarksTotalsAndFacetsApproximateAboveBudget(t *testing.T) {
	originalThreshold := catalogQueryExactMetadataThreshold
	catalogQueryExactMetadataThreshold = 2
	t.Cleanup(func() {
		catalogQueryExactMetadataThreshold = originalThreshold
	})

	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	chunk := &summaryChunk{
		items: []Summary{
			{ClusterID: "cluster-a", Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "a", UID: "uid-a", Scope: ScopeNamespace},
			{ClusterID: "cluster-a", Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "b", UID: "uid-b", Scope: ScopeNamespace},
			{ClusterID: "cluster-a", Kind: "Pod", Version: "v1", Resource: "pods", Namespace: "default", Name: "c", UID: "uid-c", Scope: ScopeNamespace},
		},
	}
	svc.publishStreamingState(
		[]*summaryChunk{chunk},
		map[string]bool{"Pod": true},
		map[string]struct{}{"default": {}},
		[]Descriptor{{Version: "v1", Resource: "pods", Kind: "Pod", Scope: ScopeNamespace, Namespaced: true}},
		true,
	)

	result := svc.Query(QueryOptions{Limit: 1})
	if result.TotalIsExact {
		t.Fatalf("expected total to be marked approximate above budget")
	}
	if result.FacetsExact {
		t.Fatalf("expected facets to be marked approximate above budget")
	}
	if result.TotalItems != 3 {
		t.Fatalf("expected approximate lower-bound total threshold+1, got %d", result.TotalItems)
	}
}

func TestQueryPreviousCursorReturnsReverseWindow(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{}
	for _, name := range []string{"a", "b", "c"} {
		svc.items[catalogKey(podDesc, "default", name)] = Summary{
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      name,
			UID:       "uid-" + name,
			Scope:     ScopeNamespace,
		}
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	svc.mu.Unlock()

	first := svc.Query(QueryOptions{Limit: 1})
	second := svc.Query(QueryOptions{Limit: 1, Continue: first.ContinueToken})
	if second.PreviousToken == "" {
		t.Fatalf("expected second page to expose a previous cursor")
	}

	previous := svc.Query(QueryOptions{Limit: 1, Continue: second.PreviousToken})
	if previous.CursorInvalid {
		t.Fatalf("expected previous cursor to remain valid")
	}
	if len(previous.Items) != 1 || previous.Items[0].Name != "a" {
		t.Fatalf("expected previous page to return a, got %+v", previous.Items)
	}
	if previous.PreviousToken != "" {
		t.Fatalf("expected first page to have no previous cursor")
	}
	if previous.ContinueToken == "" {
		t.Fatalf("expected previous page to retain a next cursor")
	}
}

func TestQueryRejectsCursorWithMismatchedSortContract(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}
	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(podDesc, "default", "a"): {
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "a",
			UID:       "uid-a",
			Scope:     ScopeNamespace,
		},
		catalogKey(podDesc, "default", "b"): {
			ClusterID: "cluster-a",
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "b",
			UID:       "uid-b",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	svc.mu.Unlock()

	first := svc.Query(QueryOptions{Limit: 1})
	if first.ContinueToken == "" {
		t.Fatalf("expected continue token")
	}

	next := svc.Query(QueryOptions{
		Limit:         1,
		SortDirection: "desc",
		Continue:      first.ContinueToken,
	})
	if !next.CursorInvalid {
		t.Fatalf("expected sort mismatch to invalidate cursor")
	}
}

func TestQueryNamespaceClusterFiltering(t *testing.T) {
	clusterDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
		Namespaced: false,
		Kind:       "CustomResourceDefinition",
		Group:      "apiextensions.k8s.io",
		Version:    "v1",
		Resource:   "customresourcedefinitions",
		Scope:      ScopeCluster,
	}
	namespacedDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"},
		Namespaced: true,
		Kind:       "Service",
		Group:      "",
		Version:    "v1",
		Resource:   "services",
		Scope:      ScopeNamespace,
	}

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(clusterDesc, "", "crd.one"): {
			Kind:     "CustomResourceDefinition",
			Group:    "apiextensions.k8s.io",
			Version:  "v1",
			Resource: "customresourcedefinitions",
			Name:     "crd.one",
			Scope:    ScopeCluster,
		},
		catalogKey(namespacedDesc, "default", "svc-one"): {
			Kind:      "Service",
			Group:     "",
			Version:   "v1",
			Resource:  "services",
			Namespace: "default",
			Name:      "svc-one",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		clusterDesc.GVR.String():    clusterDesc,
		namespacedDesc.GVR.String(): namespacedDesc,
	}
	svc.mu.Unlock()

	clusterOnly := svc.Query(QueryOptions{
		Namespaces: []string{"cluster"},
	})
	if clusterOnly.TotalItems != 1 || clusterOnly.Items[0].Scope != ScopeCluster {
		t.Fatalf("expected only cluster-scoped items, got %+v", clusterOnly)
	}
	expectedClusterKinds := []KindInfo{{Kind: "CustomResourceDefinition", Namespaced: false}}
	if !reflect.DeepEqual(clusterOnly.Kinds, expectedClusterKinds) {
		t.Fatalf("unexpected kinds for cluster query: %+v", clusterOnly.Kinds)
	}
	if !reflect.DeepEqual(clusterOnly.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces for cluster query: %+v", clusterOnly.Namespaces)
	}

	defaultNS := svc.Query(QueryOptions{
		Namespaces: []string{"default"},
	})
	if defaultNS.TotalItems != 1 || defaultNS.Items[0].Namespace != "default" {
		t.Fatalf("expected only default namespace items, got %+v", defaultNS)
	}
	expectedNSKinds := []KindInfo{{Kind: "Service", Namespaced: true}}
	if !reflect.DeepEqual(defaultNS.Kinds, expectedNSKinds) {
		t.Fatalf("unexpected kinds for namespace query: %+v", defaultNS.Kinds)
	}
	if !reflect.DeepEqual(defaultNS.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces for namespace query: %+v", defaultNS.Namespaces)
	}
}

func TestQueryNamespaceClusterFilteringUsesCachedIndex(t *testing.T) {
	clusterDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
		Namespaced: false,
		Kind:       "CustomResourceDefinition",
		Group:      "apiextensions.k8s.io",
		Version:    "v1",
		Resource:   "customresourcedefinitions",
		Scope:      ScopeCluster,
	}
	namespacedDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "services"},
		Namespaced: true,
		Kind:       "Service",
		Group:      "",
		Version:    "v1",
		Resource:   "services",
		Scope:      ScopeNamespace,
	}
	items := map[string]Summary{
		catalogKey(clusterDesc, "", "crd.one"): {
			Kind:     "CustomResourceDefinition",
			Group:    "apiextensions.k8s.io",
			Version:  "v1",
			Resource: "customresourcedefinitions",
			Name:     "crd.one",
			Scope:    ScopeCluster,
		},
		catalogKey(namespacedDesc, "default", "svc-one"): {
			Kind:      "Service",
			Group:     "",
			Version:   "v1",
			Resource:  "services",
			Namespace: "default",
			Name:      "svc-one",
			Scope:     ScopeNamespace,
		},
	}

	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	svc.mu.Lock()
	svc.catalogIndex.rebuildCacheFromItems(items, []Descriptor{
		exportDescriptor(clusterDesc),
		exportDescriptor(namespacedDesc),
	})
	svc.mu.Unlock()

	clusterOnly := svc.Query(QueryOptions{
		Namespaces: []string{"cluster"},
	})
	if clusterOnly.TotalItems != 1 || len(clusterOnly.Items) != 1 || clusterOnly.Items[0].Scope != ScopeCluster {
		t.Fatalf("expected cached index to return only cluster-scoped items, got %+v", clusterOnly)
	}
	if clusterOnly.Items[0].Namespace != "" {
		t.Fatalf("expected cluster-scoped cached item to have empty namespace, got %+v", clusterOnly.Items[0])
	}
	expectedClusterKinds := []KindInfo{{Kind: "CustomResourceDefinition", Namespaced: false}}
	if !reflect.DeepEqual(clusterOnly.Kinds, expectedClusterKinds) {
		t.Fatalf("unexpected cached kinds for cluster query: %+v", clusterOnly.Kinds)
	}
	if !reflect.DeepEqual(clusterOnly.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected cached namespaces for cluster query: %+v", clusterOnly.Namespaces)
	}
}

func TestQuerySearchFilter(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}

	svc.mu.Lock()
	svc.items = map[string]Summary{
		catalogKey(podDesc, "default", "catalog-api"): {
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "catalog-api",
			Scope:     ScopeNamespace,
		},
		catalogKey(podDesc, "default", "metrics-writer"): {
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "metrics-writer",
			Scope:     ScopeNamespace,
		},
	}
	svc.resources = map[string]resourceDescriptor{
		podDesc.GVR.String(): podDesc,
	}
	svc.mu.Unlock()

	result := svc.Query(QueryOptions{Search: "catalog"})
	if result.TotalItems != 1 {
		t.Fatalf("expected search to match 1 item, got %d", result.TotalItems)
	}
	if len(result.Items) != 1 || result.Items[0].Name != "catalog-api" {
		t.Fatalf("unexpected search results: %+v", result.Items)
	}
	expectedSearchKinds := []KindInfo{{Kind: "Pod", Namespaced: true}}
	if !reflect.DeepEqual(result.Kinds, expectedSearchKinds) {
		t.Fatalf("unexpected kinds for search: %+v", result.Kinds)
	}
	if !reflect.DeepEqual(result.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces for search: %+v", result.Namespaces)
	}
}
