package ingest

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
	clienttesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
)

// disableWatchList turns off the client-go WatchListClient feature gate for the test, so
// the reflector uses the same LIST+WATCH startup transport as production.
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
	require.True(t, m.RegisterDynamicCatalogReflector(gvr, gvk, project, true),
		"first registration of a dynamic reflector should succeed")
	require.False(t, m.RegisterDynamicCatalogReflector(gvr, gvk, project, true),
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

func TestRegisterDynamicCatalogReflectorStripsProjectionOnlyMetadata(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}
	widget := newDynUnstructured(gvk, "default", "w1", "100")
	widget.SetAnnotations(map[string]string{
		"example.com/owner": "platform",
		"kubectl.kubernetes.io/last-applied-configuration": `{"metadata":{"name":"w1"}}`,
	})
	dyn := newWidgetDynamicClient(gvr, gvk, widget)

	m := newStartedDynamicManager(ctx, dyn)
	project := func(o metav1.Object) interface{} {
		return o.GetAnnotations()
	}
	require.True(t, m.RegisterDynamicCatalogReflector(gvr, gvk, project, true))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, 2*time.Second, 10*time.Millisecond)

	rows := m.CatalogRows(gvr)
	require.Equal(t, []interface{}{
		map[string]string{"example.com/owner": "platform"},
	}, rows)
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

// Terminal shutdown evicts dynamic entries so their projected data is no longer served.
func TestStopEvictsDynamicSources(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}
	dyn := newWidgetDynamicClient(gvr, gvk, newDynUnstructured(gvk, "default", "w1", "100"))

	m := newStartedDynamicManager(ctx, dyn)
	project := func(o metav1.Object) interface{} { return dynCatRow{Namespace: o.GetNamespace(), Name: o.GetName()} }
	require.True(t, m.RegisterDynamicCatalogReflector(gvr, gvk, project, true))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, 2*time.Second, 10*time.Millisecond)

	m.Stop()
	require.Nil(t, m.StoreFor(gvr), "the entry should be evicted after terminal shutdown")
	require.False(t, m.HasSyncedFor(gvr), "a stopped reflector is no longer reported as synced")
}

func TestDynamicReflectorSkipsDeniedNamespacesWithoutBlockingReadiness(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := gvr.GroupVersion().WithKind("Widget")
	dyn := newWidgetDynamicClient(gvr, gvk,
		newDynUnstructured(gvk, "allowed", "visible", "1"),
		newDynUnstructured(gvk, "denied", "hidden", "1"))
	m := newStartedDynamicManager(ctx, dyn)
	defer m.Stop()
	m.scope = []string{"allowed", "denied"}
	m.SetPermissionFilter(func(_, _, namespace string) bool { return namespace == "allowed" })

	require.True(t, m.RegisterDynamicCatalogReflector(gvr, gvk, func(o metav1.Object) interface{} {
		return dynCatRow{Namespace: o.GetNamespace(), Name: o.GetName()}
	}, true))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, time.Second, time.Millisecond)
	require.True(t, m.HasSynced(), "a denied dynamic namespace must not hold global readiness")
	require.Equal(t, []interface{}{dynCatRow{Namespace: "allowed", Name: "visible"}}, m.CatalogRows(gvr))
	for _, action := range dyn.Actions() {
		require.Equal(t, "allowed", action.GetNamespace(), "denied partitions must issue neither LIST nor WATCH")
	}
}

func TestDynamicSourceReplacesServedVersionAndStopsPreviousWatch(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	v1 := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	v2 := v1
	v2.Version = "v2"
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(apiruntime.NewScheme(), map[schema.GroupVersionResource]string{
		v1: "WidgetList", v2: "WidgetList",
	}, newDynUnstructured(v1.GroupVersion().WithKind("Widget"), "default", "old-version", "1"),
		newDynUnstructured(v2.GroupVersion().WithKind("Widget"), "default", "new-version", "1"))
	watches := make(chan *watch.RaceFreeFakeWatcher, 2)
	dyn.PrependWatchReactor("widgets", func(clienttesting.Action) (bool, watch.Interface, error) {
		w := watch.NewRaceFreeFake()
		watches <- w
		return true, w, nil
	})
	m := newStartedDynamicManager(ctx, dyn)
	defer m.Stop()
	project := func(o metav1.Object) interface{} { return dynCatRow{Namespace: o.GetNamespace(), Name: o.GetName()} }
	spec := DynamicCatalogSpec{GVR: v1, GVK: v1.GroupVersion().WithKind("Widget"), Namespaced: true, DefinitionUID: "definition-a"}
	require.True(t, m.ReconcileDynamicCatalogSource(spec, project))
	var oldWatch *watch.RaceFreeFakeWatcher
	select {
	case oldWatch = <-watches:
	case <-time.After(time.Second):
		t.Fatal("first source did not start its watch")
	}
	spec.GVR, spec.GVK = v2, v2.GroupVersion().WithKind("Widget")
	require.True(t, m.ReconcileDynamicCatalogSource(spec, project))
	require.Eventually(t, func() bool { return m.HasSyncedFor(v2) }, time.Second, time.Millisecond)
	require.False(t, m.Tracks(v1), "the retired API version must no longer be served")
	require.True(t, oldWatch.IsStopped(), "retired workers must stop before the replacement starts")
	require.Equal(t, []interface{}{dynCatRow{Namespace: "default", Name: "new-version"}}, m.CatalogRows(v2))
	require.False(t, m.ReconcileDynamicCatalogSource(spec, project), "an unchanged source must not restart")
}

func TestDynamicAdmissionCannotOutliveShutdown(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := gvr.GroupVersion().WithKind("Widget")
	dyn := newWidgetDynamicClient(gvr, gvk)
	m := newStartedDynamicManager(ctx, dyn)
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	m.SetPermissionFilter(func(_, _, _ string) bool { close(entered); <-release; return true })
	registered := make(chan bool, 1)
	go func() {
		registered <- m.RegisterDynamicCatalogReflector(gvr, gvk, dynamicTestProjector(DynamicCatalogSpec{}), true)
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("permission check did not start")
	}
	stopped := make(chan struct{})
	go func() { m.Stop(); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("permission check held the lifecycle lock during shutdown")
	}
	releaseOnce.Do(func() { close(release) })
	select {
	case admitted := <-registered:
		require.False(t, admitted)
	case <-time.After(time.Second):
		t.Fatal("late admission did not return")
	}
	require.Empty(t, dyn.Actions())
	require.False(t, m.Tracks(gvr))
}

func TestDynamicSubscriptionSeesReadyEmptyBaselineAndDetaches(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := gvr.GroupVersion().WithKind("Widget")
	dyn := newWidgetDynamicClient(gvr, gvk)
	m := newStartedDynamicManager(ctx, dyn)
	defer m.Stop()
	observed := make(chan DynamicCatalogSnapshot, 4)
	unsubscribe := m.SubscribeDynamicCatalogChanges(func(change DynamicCatalogChange) {
		snapshot, ok := m.ReadDynamicCatalogSource(change.Source.GVR.GroupResource())
		if ok {
			observed <- snapshot
		}
	})
	require.True(t, m.RegisterDynamicCatalogReflector(gvr, gvk, dynamicTestProjector(DynamicCatalogSpec{}), true))
	select {
	case snapshot := <-observed:
		require.Equal(t, []string{""}, snapshot.ReadyNamespaces)
		require.Empty(t, snapshot.Rows)
	case <-time.After(time.Second):
		t.Fatal("empty initial LIST did not announce its ready baseline")
	}
	unsubscribe()
	_, err := dyn.Resource(gvr).Namespace("default").Create(ctx, newDynUnstructured(gvk, "default", "after-detach", "2"), metav1.CreateOptions{})
	require.NoError(t, err)
	require.Eventually(t, func() bool { return len(m.CatalogRows(gvr)) == 1 }, time.Second, time.Millisecond)
	require.Empty(t, observed, "retired consumers must not receive later source changes")
}

func TestDynamicUnsubscribeJoinsInFlightDelivery(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := gvr.GroupVersion().WithKind("Widget")
	m := newStartedDynamicManager(ctx, newWidgetDynamicClient(gvr, gvk))
	defer m.Stop()
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	unsubscribe := m.SubscribeDynamicCatalogChanges(func(DynamicCatalogChange) { close(entered); <-release })
	require.True(t, m.RegisterDynamicCatalogReflector(gvr, gvk, dynamicTestProjector(DynamicCatalogSpec{}), true))
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("source did not deliver initial baseline")
	}
	detached := make(chan struct{})
	go func() { unsubscribe(); close(detached) }()
	select {
	case <-detached:
		t.Fatal("unsubscribe returned while a retired consumer callback was still running")
	case <-time.After(25 * time.Millisecond):
	}
	once.Do(func() { close(release) })
	select {
	case <-detached:
	case <-time.After(time.Second):
		t.Fatal("unsubscribe did not join the completed callback")
	}
}

func TestStoppedDynamicGenerationCannotBeRestarted(t *testing.T) {
	ctx := context.Background()
	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	gvk := gvr.GroupVersion().WithKind("Widget")
	m := newStartedDynamicManager(ctx, newWidgetDynamicClient(gvr, gvk))
	m.Stop()
	m.Start(ctx)
	defer m.Stop()
	require.False(t, m.RegisterDynamicCatalogReflector(gvr, gvk, dynamicTestProjector(DynamicCatalogSpec{}), true), "recovery must construct a new generation rather than revive a retired owner")
}
