package ingest

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/tools/cache"
)

func definitionTestManager(t *testing.T, definitions ...*apiextensionsv1.CustomResourceDefinition) (*IngestManager, cache.SharedIndexInformer, *dynamicfake.FakeDynamicClient) {
	t.Helper()
	kinds := make(map[schema.GroupVersionResource]string)
	informer := cache.NewSharedIndexInformer(nil, &apiextensionsv1.CustomResourceDefinition{}, 0, cache.Indexers{})
	for _, definition := range definitions {
		require.NoError(t, informer.GetStore().Add(definition))
		for _, version := range definition.Spec.Versions {
			kinds[schema.GroupVersionResource{Group: definition.Spec.Group, Version: version.Name, Resource: definition.Spec.Names.Plural}] = definition.Spec.Names.Kind + "List"
		}
	}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), kinds)
	mgr := &IngestManager{dynamic: dyn, entries: make(map[schema.GroupVersionResource]*entry), syncDeadline: time.Minute, now: time.Now}
	mgr.SetCustomResourceDefinitions(informer, dynamicTestProjector)
	mgr.Start(t.Context())
	t.Cleanup(mgr.Stop)
	return mgr, informer, dyn
}

func TestSlowCRDPermissionDoesNotBlockAnotherDefinition(t *testing.T) {
	disableWatchList(t)
	widget := dynamicWidgetDefinition()
	gadget := widget.DeepCopy()
	gadget.Name, gadget.Spec.Names.Plural, gadget.Spec.Names.Kind = "gadgets.example.com", "gadgets", "Gadget"
	mgr, _, _ := definitionTestManager(t, widget, gadget)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	mgr.SetPermissionFilter(func(_, resource, _ string) bool {
		if resource == "widgets" {
			close(entered)
			<-release
		}
		return true
	})
	widgetDone := make(chan bool, 1)
	go func() {
		widgetDone <- mgr.ReconcileDiscoveredResource(schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"})
	}()
	<-entered
	gadgetDone := make(chan bool, 1)
	go func() {
		gadgetDone <- mgr.ReconcileDiscoveredResource(schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "gadgets"})
	}()
	select {
	case classified := <-gadgetDone:
		require.True(t, classified)
	case <-time.After(250 * time.Millisecond):
		t.Error("an unrelated CRD is blocked behind a slow permission review")
	}
	once.Do(func() { close(release) })
	require.True(t, <-widgetDone)
}

func TestCRDWaitsForDiscoveredVersionBeforeFirstWatch(t *testing.T) {
	disableWatchList(t)
	definition := dynamicWidgetDefinition()
	definition.Spec.Versions = append(definition.Spec.Versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2", Served: true})
	mgr, _, dyn := definitionTestManager(t, definition)
	mgr.definitionChanged(definition, false)
	v1 := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	require.False(t, mgr.Tracks(v1), "initial CRD replay must not launch a speculative storage-version watch")
	v2 := v1
	v2.Version = "v2"
	require.True(t, mgr.ReconcileDiscoveredResource(v2))
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(v2) }, time.Second, time.Millisecond)
	for _, action := range dyn.Actions() {
		require.Equal(t, v2, action.GetResource(), "startup must list only the discovered served version")
	}
}

func TestDiscoveryBeforeCRDReplayAdmitsAndRetiresTheSource(t *testing.T) {
	disableWatchList(t)
	definition := dynamicWidgetDefinition()
	definition.Spec.Versions = append(definition.Spec.Versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2", Served: true})
	mgr, informer, dyn := definitionTestManager(t, definition)
	require.NoError(t, informer.GetStore().Delete(definition))
	preferred := schema.GroupVersionResource{Group: "example.com", Version: "v2", Resource: "widgets"}
	require.False(t, mgr.ReconcileDiscoveredResource(preferred), "discovery alone must not claim a known definition")
	require.False(t, mgr.Tracks(preferred))
	require.NoError(t, informer.GetStore().Add(definition))
	mgr.definitionChanged(definition, false)
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(preferred) }, time.Second, time.Millisecond)
	for _, action := range dyn.Actions() {
		require.Equal(t, preferred, action.GetResource(), "late CRD replay must use discovery's remembered version")
	}
	require.NoError(t, informer.GetStore().Delete(definition))
	mgr.definitionChanged(cache.DeletedFinalStateUnknown{Key: definition.Name, Obj: definition}, true)
	require.False(t, mgr.Tracks(preferred), "confirmed deletion must retire and join the source")
	mgr.definitionChanged(definition, false)
	require.False(t, mgr.Tracks(preferred), "a delayed add callback must not resurrect a deleted definition")
}

func TestDelayedPermissionCannotRestoreAnOlderCRD(t *testing.T) {
	disableWatchList(t)
	definition := dynamicWidgetDefinition()
	definition.Spec.Versions = append(definition.Spec.Versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2", Served: true})
	mgr, informer, dyn := definitionTestManager(t, definition)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	var reviewed atomic.Bool
	mgr.SetPermissionFilter(func(_, _, _ string) bool {
		if !reviewed.Swap(true) {
			close(entered)
			<-release
		}
		return true
	})
	v1 := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	oldDone := make(chan bool, 1)
	go func() { oldDone <- mgr.ReconcileDiscoveredResource(v1) }()
	<-entered
	replacement := definition.DeepCopy()
	replacement.UID = "replacement"
	require.NoError(t, informer.GetStore().Update(replacement))
	v2 := v1
	v2.Version = "v2"
	require.True(t, mgr.ReconcileDiscoveredResource(v2))
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(v2) }, time.Second, time.Millisecond)
	once.Do(func() { close(release) })
	require.True(t, <-oldDone)
	source, present := mgr.ReadDynamicCatalogSource(v2.GroupResource())
	require.True(t, present)
	require.Equal(t, replacement.UID, source.Spec.DefinitionUID)
	require.Equal(t, v2, source.Spec.GVR)
	for _, action := range dyn.Actions() {
		require.Equal(t, v2, action.GetResource(), "a superseded admission must never start its API source")
	}
}

func BenchmarkUnchangedCRDReconciliation(b *testing.B) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	definition := dynamicWidgetDefinition()
	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	mgr := newStartedDynamicManager(ctx, newWidgetDynamicClient(gvr, gvr.GroupVersion().WithKind("Widget")))
	defer mgr.Stop()
	if !mgr.ReconcileCustomResourceDefinition(definition, "v1", dynamicTestProjector) {
		b.Fatal("initial admission failed")
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		mgr.ReconcileCustomResourceDefinition(definition, "v1", dynamicTestProjector)
	}
}
