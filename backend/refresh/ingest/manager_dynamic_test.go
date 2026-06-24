package ingest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
)

// disableWatchList turns off the client-go WatchListClient feature gate for the test, so
// the reflector uses LIST+WATCH — the dynamicfake client serves those but not WatchList's
// SendInitialEvents stream. Production keeps WatchList (governed by EnsureWatchListDecision);
// the projection/store/sink/readiness behavior under test is identical either way.
func disableWatchList(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
}

// dynCatRow is a stand-in catalog row the dynamic-reflector tests project to, so the
// assertions do not depend on the objectcatalog package (which is a consumer of this
// package, not a dependency).
type dynCatRow struct {
	Namespace string
	Name      string
}

func newDynUnstructured(gvk schema.GroupVersionKind, namespace, name, rv string) *unstructuredv1.Unstructured {
	u := &unstructuredv1.Unstructured{}
	u.SetGroupVersionKind(gvk)
	u.SetNamespace(namespace)
	u.SetName(name)
	u.SetResourceVersion(rv)
	return u
}

// newWidgetDynamicClient builds a fake dynamic client serving the Widget custom resource,
// with the unstructured object + list types registered in the scheme so the reflector's
// LIST decodes (mirroring objectcatalog/collect_test.go's setup).
func newWidgetDynamicClient(gvr schema.GroupVersionResource, gvk schema.GroupVersionKind, objs ...apiruntime.Object) *dynamicfake.FakeDynamicClient {
	scheme := apiruntime.NewScheme()
	scheme.AddKnownTypeWithName(gvk, &unstructuredv1.Unstructured{})
	scheme.AddKnownTypeWithName(gvk.GroupVersion().WithKind(gvk.Kind+"List"), &unstructuredv1.UnstructuredList{})
	listKinds := map[schema.GroupVersionResource]string{gvr: gvk.Kind + "List"}
	return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds, objs...)
}

// newStartedDynamicManager builds an IngestManager with NO descriptor reflectors (so
// Start launches nothing that needs a typed RESTClient) but WITH a dynamic client, then
// starts it so RegisterDynamicCatalogReflector can launch on the run context. Building the
// struct directly (white-box) avoids NewIngestManager's StreamDescriptors loop, whose
// reflectors would panic against a fake kube RESTClient.
func newStartedDynamicManager(ctx context.Context, dyn *dynamicfake.FakeDynamicClient) *IngestManager {
	m := &IngestManager{
		meta:         streamrows.ClusterMeta{},
		dynamic:      dyn,
		entries:      make(map[schema.GroupVersionResource]*entry),
		syncDeadline: time.Minute,
		now:          time.Now,
	}
	m.Start(ctx)
	return m
}

// TestRegisterDynamicCatalogReflectorServesCatalogRows pins the on-demand dynamic-CRD
// cutover: a reflector registered after Start, fed by the dynamic client, projects each
// custom resource to its catalog row and serves them from CatalogRows once synced.
func TestRegisterDynamicCatalogReflectorServesCatalogRows(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}
	w1 := newDynUnstructured(gvk, "default", "w1", "100")
	w2 := newDynUnstructured(gvk, "default", "w2", "101")
	dyn := newWidgetDynamicClient(gvr, gvk, w1, w2)

	m := newStartedDynamicManager(ctx, dyn)

	project := func(o metav1.Object) interface{} {
		return dynCatRow{Namespace: o.GetNamespace(), Name: o.GetName()}
	}
	require.True(t, m.RegisterDynamicCatalogReflector(gvr, gvk, project),
		"first registration of a dynamic reflector should succeed")
	require.False(t, m.RegisterDynamicCatalogReflector(gvr, gvk, project),
		"re-registering the same gvr should be a no-op")

	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, 2*time.Second, 10*time.Millisecond,
		"the dynamic reflector's initial relist should land")

	rows := m.CatalogRows(gvr)
	got := map[string]bool{}
	for _, r := range rows {
		row, ok := r.(dynCatRow)
		require.True(t, ok, "catalog row should be the projected type")
		got[row.Name] = true
	}
	require.Equal(t, map[string]bool{"w1": true, "w2": true}, got)
}

// TestGlobalHasSyncedIgnoresOnDemandEntries proves the readiness isolation: an on-demand
// dynamic reflector that has NOT synced must not gate the whole-manager HasSynced (which
// blocks the metrics poller — the issue-#225 class), yet its per-gvr HasSyncedFor reports
// its real sync state so the catalog can serve-when-synced-else-LIST.
func TestGlobalHasSyncedIgnoresOnDemandEntries(t *testing.T) {
	m := &IngestManager{
		entries:      make(map[schema.GroupVersionResource]*entry),
		syncDeadline: time.Minute,
		now:          time.Now,
	}

	// A settled built-in entry (its store has completed an initial relist).
	gvrA := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"}
	settled := &entry{store: NewProjectingStore(func(o interface{}) (interface{}, error) { return o, nil })}
	require.NoError(t, settled.store.Replace(nil, "1"))
	m.entries[gvrA] = settled
	require.True(t, m.HasSynced(), "a manager whose only entry is settled is ready")

	// An on-demand entry whose store has NOT synced.
	gvrB := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	onDemand := &entry{store: NewProjectingStore(func(o interface{}) (interface{}, error) { return o, nil })}
	onDemand.onDemand.Store(true)
	m.entries[gvrB] = onDemand

	require.True(t, m.HasSynced(),
		"an unsynced on-demand reflector must NOT gate the global readiness/metrics path")
	require.False(t, m.HasSyncedFor(gvrB),
		"but its per-gvr HasSyncedFor reports the real (unsynced) state")
}

// TestStopReflectorForEvicts proves teardown: stopping a dynamic reflector removes its
// entry so the manager no longer serves or reports it.
func TestStopReflectorForEvicts(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}
	dyn := newWidgetDynamicClient(gvr, gvk, newDynUnstructured(gvk, "default", "w1", "100"))

	m := newStartedDynamicManager(ctx, dyn)
	project := func(o metav1.Object) interface{} { return dynCatRow{Namespace: o.GetNamespace(), Name: o.GetName()} }
	require.True(t, m.RegisterDynamicCatalogReflector(gvr, gvk, project))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, 2*time.Second, 10*time.Millisecond)

	m.StopReflectorFor(gvr)
	require.Nil(t, m.StoreFor(gvr), "the entry should be evicted after StopReflectorFor")
	require.False(t, m.HasSyncedFor(gvr), "a stopped reflector is no longer reported as synced")
}
