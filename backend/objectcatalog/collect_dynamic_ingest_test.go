package objectcatalog

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	runtime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"

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
	stopped  map[schema.GroupVersionResource]bool
	sinks    map[schema.GroupVersionResource][]ingest.Sink
}

func newFakeDynamicIngestSource() *fakeDynamicIngestSource {
	return &fakeDynamicIngestSource{
		seeded:   map[schema.GroupVersionResource][]metav1.Object{},
		projects: map[schema.GroupVersionResource]ingest.CatalogProjector{},
		stopped:  map[schema.GroupVersionResource]bool{},
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

func (f *fakeDynamicIngestSource) RegisterDynamicCatalogReflector(gvr schema.GroupVersionResource, _ schema.GroupVersionKind, project ingest.CatalogProjector) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.projects[gvr]; ok {
		return false
	}
	f.projects[gvr] = project
	return true
}

func (f *fakeDynamicIngestSource) StopReflectorFor(gvr schema.GroupVersionResource) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stopped[gvr] = true
	delete(f.projects, gvr)
}

func (f *fakeDynamicIngestSource) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.projects[gvr]
	return ok && !f.stopped[gvr]
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

func widgetDesc() resourceDescriptor {
	return resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
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

// TestCatalogDynamicCRDViaIngestMatchesListPath is the dynamic-CRD cutover gate: once a
// custom-resource kind crosses the promotion threshold, the catalog registers an on-demand
// dynamic reflector with the ingest source and serves the kind's Summaries from the ingest
// path — and those Summaries must equal the ones the pure-LIST path produces.
func TestCatalogDynamicCRDViaIngestMatchesListPath(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	ctx := context.Background()
	desc := widgetDesc()
	w1 := widgetObject("default", "w1", "100")
	w2 := widgetObject("default", "w2", "101")
	w3 := widgetObject("kube-system", "w3", "102")

	// Pure-LIST reference: no promotion (threshold 0), so collectResource always lists.
	listSvc := NewService(Dependencies{
		Common:      common.Dependencies{Context: ctx, DynamicClient: widgetDynamicClient(w1, w2, w3)},
		ClusterID:   "c1",
		ClusterName: "cluster-one",
	}, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2, InformerPromotionThreshold: 0})
	listSummaries, err := listSvc.collectResource(ctx, 0, desc, nil, nil)
	require.NoError(t, err)
	require.Len(t, listSummaries, 3)

	// Ingest-backed Service: threshold 2, so 3 objects promote the kind to the ingest path.
	fake := newFakeDynamicIngestSource()
	fake.seed(desc.GVR, w1, w2, w3)
	ingestSvc := NewService(Dependencies{
		Common:       common.Dependencies{Context: ctx, DynamicClient: widgetDynamicClient(w1, w2, w3)},
		IngestSource: fake,
		ClusterID:    "c1",
		ClusterName:  "cluster-one",
	}, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2, InformerPromotionThreshold: 2})

	// First collect lists (the reflector is not yet registered) and crosses the threshold,
	// which registers the on-demand dynamic reflector with the ingest source.
	first, err := ingestSvc.collectResource(ctx, 0, desc, nil, nil)
	require.NoError(t, err)
	require.Len(t, first, 3)
	require.True(t, fake.registered(desc.GVR),
		"crossing the promotion threshold must register a dynamic reflector with the ingest source")

	// Second collect serves from the ingest path (CatalogRows), and the Summaries must equal
	// the pure-LIST path's.
	second, err := ingestSvc.collectResource(ctx, 0, desc, nil, nil)
	require.NoError(t, err)
	require.ElementsMatch(t, listSummaries, second,
		"ingest-served Summaries must equal the list-path Summaries")
}

// TestCatalogDynamicCRDPromotesOnlyAboveThreshold pins the on-demand semantics: a kind
// whose object count stays below the threshold is never registered with the ingest source —
// it keeps being listed, exactly as before, so the ingest path is only used on demand.
func TestCatalogDynamicCRDPromotesOnlyAboveThreshold(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	ctx := context.Background()
	desc := widgetDesc()
	w1 := widgetObject("default", "w1", "100")

	fake := newFakeDynamicIngestSource()
	fake.seed(desc.GVR, w1)
	svc := NewService(Dependencies{
		Common:       common.Dependencies{Context: ctx, DynamicClient: widgetDynamicClient(w1)},
		IngestSource: fake,
		ClusterID:    "c1",
		ClusterName:  "cluster-one",
	}, &Options{ResyncInterval: time.Minute, PageSize: 200, ListWorkers: 2, InformerPromotionThreshold: 5})

	summaries, err := svc.collectResource(ctx, 0, desc, nil, nil)
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	require.False(t, fake.registered(desc.GVR),
		"a kind below the promotion threshold must NOT be promoted to the ingest path")
}
