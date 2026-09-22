package objectcatalog

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	runtime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/common"
)

// fakeDynamicIngestSource is an in-memory IngestSource used to test the catalog's
// dynamic-CRD cutover routing in isolation from the real reflector (which needs a real
// RESTClient and is covered by the ingest package's own tests). RegisterDynamicCatalogReflector
// captures the catalog-supplied projector and the kind is treated as synced immediately;
// CatalogRows applies that projector to the seeded source objects — so the rows it serves
// are exactly what the catalog's own projection produces, isolating the routing under test.
type fakeDynamicIngestSource struct {
	mu       sync.Mutex
	seeded   map[schema.GroupVersionResource][]metav1.Object
	projects map[schema.GroupVersionResource]ingest.CatalogProjector
	sinks    map[schema.GroupVersionResource][]ingest.Sink
}

func newFakeDynamicIngestSource() *fakeDynamicIngestSource {
	return &fakeDynamicIngestSource{
		seeded:   map[schema.GroupVersionResource][]metav1.Object{},
		projects: map[schema.GroupVersionResource]ingest.CatalogProjector{},
		sinks:    map[schema.GroupVersionResource][]ingest.Sink{},
	}
}

func (f *fakeDynamicIngestSource) seed(gvr schema.GroupVersionResource, objs ...metav1.Object) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seeded[gvr] = objs
}

func (f *fakeDynamicIngestSource) registered(gvr schema.GroupVersionResource) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.projects[gvr]
	return ok
}

func (f *fakeDynamicIngestSource) RegisterDynamicCatalogReflector(gvr schema.GroupVersionResource, _ schema.GroupVersionKind, project ingest.CatalogProjector, _ bool) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.projects[gvr]; ok {
		return false
	}
	f.projects[gvr] = project
	return true
}

func (f *fakeDynamicIngestSource) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.projects[gvr]
	return ok
}

func (f *fakeDynamicIngestSource) Tracks(gvr schema.GroupVersionResource) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.projects[gvr]
	return ok
}

func (f *fakeDynamicIngestSource) CatalogRows(gvr schema.GroupVersionResource) []interface{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	project, ok := f.projects[gvr]
	if !ok {
		return nil
	}
	out := make([]interface{}, 0, len(f.seeded[gvr]))
	for _, obj := range f.seeded[gvr] {
		out = append(out, project(obj))
	}
	return out
}

func (f *fakeDynamicIngestSource) AddCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sinks[gvr] = append(f.sinks[gvr], sink)
	return true
}

func widgetDesc() Descriptor {
	return Descriptor{

		Namespaced: true,
		Kind:       "Widget",
		Group:      "example.com",
		Version:    "v1",
		Resource:   "widgets",
		Scope:      ScopeNamespace,
	}
}

func widgetObject(namespace, name, rv string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"})
	u.SetNamespace(namespace)
	u.SetName(name)
	u.SetResourceVersion(rv)
	u.SetLabels(map[string]string{"app": name})
	return u
}

func widgetDynamicClient(objs ...runtime.Object) *dynamicfake.FakeDynamicClient {
	scheme := runtime.NewScheme()
	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}
	scheme.AddKnownTypeWithName(gvk, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(gvk.GroupVersion().WithKind("WidgetList"), &unstructured.UnstructuredList{})
	listKinds := map[schema.GroupVersionResource]string{
		{Group: "example.com", Version: "v1", Resource: "widgets"}: "WidgetList",
	}
	return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds, objs...)
}

// TestUnclassifiedDynamicResourcePromotionMatchesListPath is the unclassified-resource promotion contract: once a
// discovered kind without a visible CRD crosses the promotion threshold, the catalog registers an on-demand
// dynamic reflector with the ingest source and serves the kind's Summaries from the ingest
// path — and those Summaries must equal the ones the pure-LIST path produces.
func TestUnclassifiedDynamicResourcePromotionMatchesListPath(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	ctx := context.Background()
	desc := widgetDesc()
	w1 := widgetObject("default", "w1", "100")
	w2 := widgetObject("default", "w2", "101")
	w3 := widgetObject("kube-system", "w3", "102")

	// Pure-LIST reference: no promotion (threshold 0), so collectResource always lists.
	listSvc := NewService(Dependencies{
		Common:    common.Dependencies{DynamicClient: widgetDynamicClient(w1, w2, w3)},
		ClusterID: "c1",
	}, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2, InformerPromotionThreshold: 0})
	listSummaries, err := listSvc.collectResource(ctx, desc, nil, nil)
	require.NoError(t, err)
	require.Len(t, listSummaries, 3)

	// Ingest-backed Service: threshold 2, so 3 objects promote the kind to the ingest path.
	fake := newFakeDynamicIngestSource()
	fake.seed(desc.GVR(), w1, w2, w3)
	ingestSvc := NewService(Dependencies{
		Common:       common.Dependencies{DynamicClient: widgetDynamicClient(w1, w2, w3)},
		IngestSource: fake,
		ClusterID:    "c1",
	}, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2, InformerPromotionThreshold: 2})

	// First collect lists (the reflector is not yet registered) and crosses the threshold,
	// which registers the on-demand dynamic reflector with the ingest source.
	first, err := ingestSvc.collectResource(ctx, desc, nil, nil)
	require.NoError(t, err)
	require.Len(t, first, 3)
	require.True(t, fake.registered(desc.GVR()),
		"crossing the promotion threshold must register a dynamic reflector with the ingest source")

	// Second collect serves from the ingest path (CatalogRows), and the Summaries must equal
	// the pure-LIST path's.
	second, err := ingestSvc.collectResource(ctx, desc, nil, nil)
	require.NoError(t, err)
	require.ElementsMatch(t, listSummaries, second,
		"ingest-served Summaries must equal the list-path Summaries")
}

// TestUnclassifiedDynamicResourcePromotesOnlyAboveThreshold pins the on-demand semantics: a kind
// whose object count stays below the threshold is never registered with the ingest source —
// it keeps being listed, exactly as before, so the ingest path is only used on demand.
func TestUnclassifiedDynamicResourcePromotesOnlyAboveThreshold(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	ctx := context.Background()
	desc := widgetDesc()
	w1 := widgetObject("default", "w1", "100")

	fake := newFakeDynamicIngestSource()
	fake.seed(desc.GVR(), w1)
	svc := NewService(Dependencies{
		Common:       common.Dependencies{DynamicClient: widgetDynamicClient(w1)},
		IngestSource: fake,
		ClusterID:    "c1",
	}, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2, InformerPromotionThreshold: 5})

	summaries, err := svc.collectResource(ctx, desc, nil, nil)
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	require.False(t, fake.registered(desc.GVR()),
		"a kind below the promotion threshold must NOT be promoted to the ingest path")
}

func TestPromotedSourcePreservesListOnlyNamespaceRows(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	desc := widgetDesc()
	dyn := widgetDynamicClient(widgetObject("watchable", "watched", "1"), widgetObject("list-only", "listed", "1"))
	dyn.PrependReactor("list", "widgets", func(action clienttesting.Action) (bool, runtime.Object, error) {
		if action.GetNamespace() == "denied" {
			return true, nil, apierrors.NewForbidden(desc.GVR().GroupResource(), "", errors.New("denied"))
		}
		return false, nil, nil
	})
	scope := []string{"watchable", "list-only", "denied"}
	mgr := ingest.NewIngestManager(streamrows.ClusterMeta{ClusterID: "c1"}, kubefake.NewClientset(), nil, nil, scope...)
	mgr.SetDynamicClient(dyn)
	mgr.SetPermissionFilter(func(group, _, namespace string) bool { return group == desc.Group && namespace == "watchable" })
	mgr.Start(ctx)
	defer mgr.Stop()
	svc := NewService(Dependencies{
		Common: common.Dependencies{DynamicClient: dyn}, IngestSource: mgr, ClusterID: "c1", AllowedNamespaces: scope,
	}, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2, InformerPromotionThreshold: 1})
	first, err := svc.collectResource(ctx, desc, scope, nil)
	require.NoError(t, err)
	require.Len(t, first, 2)
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(desc.GVR()) }, time.Second, time.Millisecond)
	require.True(t, mgr.HasSynced())
	for _, action := range dyn.Actions() {
		if action.GetVerb() == "watch" {
			require.Equal(t, "watchable", action.GetNamespace())
		}
	}
	second, err := svc.collectResource(ctx, desc, scope, nil)
	require.NoError(t, err)
	require.ElementsMatch(t, first, second, "promotion must preserve rows in namespaces that grant LIST but deny WATCH")
	registerDesc(svc, desc)
	svc.replaceIngestCatalogSummaries(desc.GVR(), first)
	unsubscribe := mgr.SubscribeDynamicCatalogChanges(svc.applyDynamicCatalogChange)
	defer svc.stopIngestReconciliation()
	defer unsubscribe()
	updated := widgetObject("watchable", "watched", "2")
	func() {
		svc.syncMu.Lock()
		defer svc.syncMu.Unlock()
		_, updateErr := dyn.Resource(desc.GVR()).Namespace("watchable").Update(ctx, updated, metav1.UpdateOptions{})
		if updateErr != nil {
			t.Fatal(updateErr)
		}
		require.Eventually(t, func() bool {
			svc.ingestPendingMu.Lock()
			defer svc.ingestPendingMu.Unlock()
			return svc.ingestDrainDone != nil
		}, time.Second, time.Millisecond)
	}()
	require.Eventually(t, func() bool {
		result := svc.Query(QueryOptions{})
		if len(result.Items) != 2 {
			return false
		}
		for _, row := range result.Items {
			if row.Ref.Name == "watched" {
				return row.ResourceVersion == "2"
			}
		}
		return false
	}, time.Second, time.Millisecond, "contended watch reconciliation must retain the LIST-only partition")
}

func (f *fakeDynamicIngestSource) ReadDynamicCatalogSource(gr schema.GroupResource) (ingest.DynamicCatalogSnapshot, bool) {
	f.mu.Lock()
	var selected schema.GroupVersionResource
	for gvr := range f.projects {
		if gvr.GroupResource() == gr {
			selected = gvr
			break
		}
	}
	f.mu.Unlock()
	if selected.Resource == "" {
		return ingest.DynamicCatalogSnapshot{}, false
	}
	return ingest.DynamicCatalogSnapshot{Spec: ingest.DynamicCatalogSpec{GVR: selected}, ReadyNamespaces: []string{""}, Rows: f.CatalogRows(selected)}, true
}
func (*fakeDynamicIngestSource) SubscribeDynamicCatalogChanges(func(ingest.DynamicCatalogChange)) func() {
	return func() {}
}

func (*fakeDynamicIngestSource) IsDynamicCatalogGeneration(schema.GroupResource, uint64) bool {
	return false
}

func TestDynamicPublicationPreservesReplacementIdentity(t *testing.T) {
	mgr, svc, desc := dynamicCatalogFixture(t, "c1")
	source, ok := mgr.ReadDynamicCatalogSource(desc.GVR().GroupResource())
	require.True(t, ok)
	rows, err := svc.collectResource(t.Context(), desc, nil, nil)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	// The selected watch version can differ from discovery's canonical version.
	desc.Version = "v2"
	registerDesc(svc, desc)
	current := rows[0]
	current.Ref.UID = "replacement"
	svc.applyDynamicCatalogChange(ingest.DynamicCatalogChange{Source: source.Spec, Generation: source.Generation, Row: current})
	old := current
	old.Ref.UID = "retired"
	svc.applyDynamicCatalogChange(ingest.DynamicCatalogChange{Source: source.Spec, Generation: source.Generation - 1, Row: old})
	svc.applyDynamicCatalogChange(ingest.DynamicCatalogChange{Source: source.Spec, Generation: source.Generation, Row: old, Deleted: true})
	result := svc.Query(QueryOptions{})
	require.Len(t, result.Items, 1, "a delayed old-UID deletion cannot remove the replacement")
	require.Equal(t, "replacement", result.Items[0].Ref.UID)
	require.Equal(t, "v2", result.Items[0].Ref.Version)
	svc.applyDynamicCatalogChange(ingest.DynamicCatalogChange{Source: source.Spec, Generation: source.Generation, Row: current, Deleted: true})
	require.Zero(t, svc.Query(QueryOptions{}).TotalItems, "the matching incarnation must still delete")
}

func TestDynamicCollectionRejectsAnotherClustersProjection(t *testing.T) {
	_, svc, desc := dynamicCatalogFixture(t, "another-cluster")
	rows, err := svc.collectResource(t.Context(), desc, nil, nil)
	require.NoError(t, err)
	require.Empty(t, rows, "a projection from another cluster must never enter this catalog")
}

func dynamicCatalogFixture(t *testing.T, projectedCluster string) (*ingest.IngestManager, *Service, Descriptor) {
	t.Helper()
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	desc := widgetDesc()
	dyn := widgetDynamicClient(widgetObject("default", "widget", "1"))
	mgr := ingest.NewIngestManager(streamrows.ClusterMeta{ClusterID: "c1"}, kubefake.NewClientset(), nil, nil)
	mgr.SetDynamicClient(dyn)
	mgr.SetPermissionFilter(func(group, _, _ string) bool { return group == desc.Group })
	mgr.Start(t.Context())
	t.Cleanup(mgr.Stop)
	project := func(obj metav1.Object) interface{} { return summaryFromObject(projectedCluster, desc, obj) }
	require.True(t, mgr.RegisterDynamicCatalogReflector(desc.GVR(), desc.GVR().GroupVersion().WithKind(desc.Kind), project, true))
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(desc.GVR()) }, time.Second, time.Millisecond)
	svc := NewService(Dependencies{Common: common.Dependencies{DynamicClient: dyn}, IngestSource: mgr, ClusterID: "c1"}, nil)
	t.Cleanup(svc.stopIngestReconciliation)
	return mgr, svc, desc
}

func (*fakeDynamicIngestSource) ReconcileDiscoveredResource(schema.GroupVersionResource) bool {
	return false
}

func (source *fakeDynamicIngestSource) SubscribeCatalogSink(gvr schema.GroupVersionResource, sink ingest.Sink) func() {
	source.AddCatalogSink(gvr, sink)
	return func() {}
}
