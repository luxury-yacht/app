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

	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

// definitionTestManager is a started manager whose CRD store feeds its dynamic
// definitions. Tests write CRDs to that store through the reflector's own
// entry points (Add, Update, Delete, Replace).
func definitionTestManager(t *testing.T, definitions ...*apiextensionsv1.CustomResourceDefinition) (*IngestManager, *ProjectingStore, *dynamicfake.FakeDynamicClient) {
	t.Helper()
	kinds := make(map[schema.GroupVersionResource]string)
	objects := make([]interface{}, 0, len(definitions))
	for _, definition := range definitions {
		objects = append(objects, definition)
		for _, version := range definition.Spec.Versions {
			kinds[schema.GroupVersionResource{Group: definition.Spec.Group, Version: version.Name, Resource: definition.Spec.Names.Plural}] = definition.Spec.Names.Kind + "List"
		}
	}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), kinds)
	crds := &entry{desc: apiextensions.StreamDescriptor, gvr: apiextensions.Identity.GVR()}
	crds.store = newIngestProjectingStore(projectionFor(testMeta, crds))
	mgr := &IngestManager{dynamic: dyn, entries: map[schema.GroupVersionResource]*entry{crds.gvr: crds}, syncDeadline: time.Minute, now: time.Now}
	require.True(t, mgr.SetCustomResourceDefinitions(dynamicTestProjector))
	require.NoError(t, crds.store.Replace(objects, "1"))
	mgr.Start(t.Context())
	t.Cleanup(mgr.Stop)
	return mgr, crds.store, dyn
}

// withVersion returns the definition at a new resourceVersion, as an update
// that changes nothing discovery reads.
func withVersion(definition *apiextensionsv1.CustomResourceDefinition, rv string) *apiextensionsv1.CustomResourceDefinition {
	updated := definition.DeepCopy()
	updated.ResourceVersion = rv
	return updated
}

// blockingReview blocks the first permission review after arm, until release.
type blockingReview struct {
	armed   atomic.Bool
	entered chan struct{}
	release chan struct{}
	once    sync.Once
	reviews atomic.Int32
}

func newBlockingReview(t *testing.T) *blockingReview {
	review := &blockingReview{entered: make(chan struct{}), release: make(chan struct{})}
	t.Cleanup(review.unblock)
	return review
}

func (r *blockingReview) filter(string, string, string) bool {
	r.reviews.Add(1)
	if r.armed.CompareAndSwap(true, false) {
		close(r.entered)
		<-r.release
	}
	return true
}

func (r *blockingReview) unblock() { r.once.Do(func() { close(r.release) }) }

// actionsOn counts the dynamic client's requests for gvr.
func actionsOn(dyn *dynamicfake.FakeDynamicClient, gvr schema.GroupVersionResource) int {
	count := 0
	for _, action := range dyn.Actions() {
		if action.GetResource() == gvr {
			count++
		}
	}
	return count
}

func TestSlowCRDPermissionDoesNotBlockAnotherDefinition(t *testing.T) {
	disableWatchList(t)
	widget := dynamicWidgetDefinition()
	gadget := widget.DeepCopy()
	gadget.Name, gadget.Spec.Names.Plural, gadget.Spec.Names.Kind = "gadgets.example.com", "gadgets", "Gadget"
	mgr, _, _ := definitionTestManager(t, widget, gadget)
	entered, release := make(chan struct{}), make(chan struct{})
	var once, enteredOnce sync.Once
	defer once.Do(func() { close(release) })
	// Both discovery and the lifecycle worker may review widgets; each review
	// blocks until release.
	mgr.SetPermissionFilter(func(_, resource, _ string) bool {
		if resource == "widgets" {
			enteredOnce.Do(func() { close(entered) })
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
	mgr, crds, dyn := definitionTestManager(t, definition)
	require.NoError(t, crds.Update(withVersion(definition, "2")))
	v1 := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	require.Never(t, func() bool { return mgr.Tracks(v1) }, 100*time.Millisecond, time.Millisecond, "CRD intake must not launch a speculative storage-version watch")
	v2 := v1
	v2.Version = "v2"
	require.True(t, mgr.ReconcileDiscoveredResource(v2))
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(v2) }, time.Second, time.Millisecond)
	for _, action := range dyn.Actions() {
		require.Equal(t, v2, action.GetResource(), "startup must list only the discovered served version")
	}
}

func TestDiscoveryBeforeCRDIntakeAdmitsAndRetiresTheSource(t *testing.T) {
	disableWatchList(t)
	definition := dynamicWidgetDefinition()
	definition.Spec.Versions = append(definition.Spec.Versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2", Served: true})
	mgr, crds, dyn := definitionTestManager(t, definition)
	require.NoError(t, crds.Delete(definition))
	preferred := schema.GroupVersionResource{Group: "example.com", Version: "v2", Resource: "widgets"}
	require.False(t, mgr.ReconcileDiscoveredResource(preferred), "discovery alone must not claim a known definition")
	require.False(t, mgr.Tracks(preferred))
	require.NoError(t, crds.Add(definition))
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(preferred) }, time.Second, time.Millisecond)
	for _, action := range dyn.Actions() {
		require.Equal(t, preferred, action.GetResource(), "late CRD intake must use discovery's remembered version")
	}
	require.NoError(t, crds.Delete(definition))
	require.Eventually(t, func() bool { return !mgr.Tracks(preferred) }, time.Second, time.Millisecond, "confirmed deletion must retire and join the source")
	mgr.definitions.lifecycle.UpsertBundle(Bundle{Aggregate: apiextensions.BuildDefinition(definition)})
	require.Never(t, func() bool { return mgr.Tracks(preferred) }, 100*time.Millisecond, time.Millisecond, "a delayed definition event must not resurrect a deleted definition")
}

func TestDelayedPermissionCannotRestoreAnOlderCRD(t *testing.T) {
	disableWatchList(t)
	definition := dynamicWidgetDefinition()
	definition.Spec.Versions = append(definition.Spec.Versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2", Served: true})
	mgr, crds, dyn := definitionTestManager(t, definition)
	entered, release := make(chan struct{}), make(chan struct{})
	var once, enteredOnce sync.Once
	defer once.Do(func() { close(release) })
	// Every review blocks until the replacement is published, so no v1
	// admission — this test's, or the setup's queued reconcile running late —
	// can commit before it.
	var replaced atomic.Bool
	mgr.SetPermissionFilter(func(_, _, _ string) bool {
		if !replaced.Load() {
			enteredOnce.Do(func() { close(entered) })
			<-release
		}
		return true
	})
	v1 := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	oldDone := make(chan bool, 1)
	go func() { oldDone <- mgr.ReconcileDiscoveredResource(v1) }()
	<-entered
	replacement := withVersion(definition, "2")
	replacement.UID = "replacement"
	replacement.Spec.Versions = []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v2", Served: true, Storage: true}}
	require.NoError(t, crds.Update(replacement))
	replaced.Store(true)
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

// admitThenBlockTheWorker admits the widgets source at v1, then makes the
// lifecycle worker reconcile toward v2 and blocks it in that admission's
// permission review.
func admitThenBlockTheWorker(t *testing.T, mgr *IngestManager, crds *ProjectingStore, definition *apiextensionsv1.CustomResourceDefinition) *blockingReview {
	t.Helper()
	review := newBlockingReview(t)
	mgr.SetPermissionFilter(review.filter)
	v1 := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	require.True(t, mgr.ReconcileDiscoveredResource(v1))
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(v1) }, time.Second, time.Millisecond)
	mgr.definitions.mu.Lock()
	mgr.definitions.preferred[v1.GroupResource()] = "v2"
	mgr.definitions.mu.Unlock()
	review.armed.Store(true)
	require.NoError(t, crds.Update(withVersion(definition, "2")))
	select {
	case <-review.entered:
	case <-time.After(time.Second):
		t.Fatal("the lifecycle worker never reviewed the v2 admission")
	}
	return review
}

// A definition deleted while the lifecycle worker is blocked in a review is
// gone from discovery at once, and the blocked admission of the deleted
// definition never commits, though its delete event is still queued behind it.
func TestBlockedDefinitionWorkerCannotCommitADeletedDefinition(t *testing.T) {
	disableWatchList(t)
	definition := dynamicWidgetDefinition()
	definition.Spec.Versions = append(definition.Spec.Versions, apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2", Served: true})
	mgr, crds, dyn := definitionTestManager(t, definition)
	review := admitThenBlockTheWorker(t, mgr, crds, definition)
	v1 := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	v2 := v1
	v2.Version = "v2"

	require.NoError(t, crds.Delete(definition))
	reviews := review.reviews.Load()
	require.False(t, mgr.ReconcileDiscoveredResource(v2), "a deleted definition is unknown to discovery at once")
	require.Equal(t, reviews, review.reviews.Load(), "discovery must start no admission for a deleted definition")

	generation := admittedGeneration(mgr)
	review.unblock()
	require.Eventually(t, func() bool { return !mgr.Tracks(v1) }, time.Second, time.Millisecond, "the queued delete retires the v1 source")
	require.Equal(t, generation, admittedGeneration(mgr), "the deleted definition's blocked admission must never commit")
	require.Zero(t, actionsOn(dyn, v2))
}

// admittedGeneration counts the dynamic sources ever admitted.
func admittedGeneration(mgr *IngestManager) uint64 {
	mgr.mu.Lock()
	defer mgr.mu.Unlock()
	return mgr.dynamicGeneration
}

// A replacement definition that arrives while the lifecycle worker is blocked
// is visible to discovery at once and admits only its own version; the
// blocked admission of the old incarnation never commits.
func TestBlockedDefinitionWorkerCannotCommitAReplacedDefinition(t *testing.T) {
	disableWatchList(t)
	definition := dynamicWidgetDefinition()
	definition.Spec.Versions = append(definition.Spec.Versions,
		apiextensionsv1.CustomResourceDefinitionVersion{Name: "v2", Served: true},
		apiextensionsv1.CustomResourceDefinitionVersion{Name: "v3", Served: true})
	mgr, crds, dyn := definitionTestManager(t, definition)
	review := admitThenBlockTheWorker(t, mgr, crds, definition)
	v2 := schema.GroupVersionResource{Group: "example.com", Version: "v2", Resource: "widgets"}
	v3 := v2
	v3.Version = "v3"

	replacement := withVersion(definition, "3")
	replacement.UID = "replacement"
	replacement.Spec.Versions = []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v3", Served: true, Storage: true}}
	require.NoError(t, crds.Update(replacement))
	require.True(t, mgr.ReconcileDiscoveredResource(v3), "the replacement is visible to discovery at once")
	require.Eventually(t, func() bool { return mgr.HasSyncedFor(v3) }, time.Second, time.Millisecond)

	review.unblock()
	require.Never(t, func() bool { return mgr.Tracks(v2) }, 100*time.Millisecond, time.Millisecond)
	source, present := mgr.ReadDynamicCatalogSource(v3.GroupResource())
	require.True(t, present)
	require.Equal(t, replacement.UID, source.Spec.DefinitionUID)
	require.Equal(t, v3, source.Spec.GVR)
	require.Zero(t, actionsOn(dyn, v2), "the old incarnation's admission must never start its API source")
}

func BenchmarkUnchangedCRDReconciliation(b *testing.B) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	definition := dynamicWidgetDefinition()
	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	mgr := newStartedDynamicManager(ctx, newWidgetDynamicClient(gvr, gvr.GroupVersion().WithKind("Widget")))
	defer mgr.Stop()
	if !mgr.ReconcileCustomResourceDefinition(apiextensions.BuildDefinition(definition), "v1", dynamicTestProjector) {
		b.Fatal("initial admission failed")
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		mgr.ReconcileCustomResourceDefinition(apiextensions.BuildDefinition(definition), "v1", dynamicTestProjector)
	}
}
