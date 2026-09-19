package objectcatalog

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

type catalogWatchSourceStub struct {
	object   metav1.Object
	ready    bool
	listener func(resourcemodel.ResourceRef)
	lookup   func(resourcemodel.ResourceRef) metav1.Object
}

func (source *catalogWatchSourceStub) SubscribeCustomResourceChanges(listener func(resourcemodel.ResourceRef)) func() {
	source.listener = listener
	return func() { source.listener = nil }
}

func (source *catalogWatchSourceStub) WatchedCustomResource(ref resourcemodel.ResourceRef) (metav1.Object, bool) {
	if source.lookup != nil {
		return source.lookup(ref), source.ready
	}
	return source.object, source.ready
}

// Initial informer replays can exceed the payload queue while the catalog's
// initial LIST still owns publication. They must reconcile without another LIST.
func TestCustomResourceStartupBurstCoalescesWithoutFullSync(t *testing.T) {
	svc := newTestWatchService()
	desc := Descriptor{Group: "external-secrets.io", Version: "v1", Kind: "ExternalSecret", Resource: "externalsecrets", Namespaced: true, Scope: ScopeNamespace}
	registerDesc(svc, desc)
	var reads atomic.Int64
	source := &catalogWatchSourceStub{ready: true, lookup: func(ref resourcemodel.ResourceRef) metav1.Object {
		reads.Add(1)
		if ref.Name == "deleted" {
			return nil
		}
		return &metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{
			Namespace: ref.Namespace, Name: ref.Name, UID: "current-uid", ResourceVersion: "current",
		}}
	}}
	svc.deps.CustomResourceSource = source
	notifier := newWatchNotifier(svc)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	unsubscribe := notifier.subscribeCustomResources(ctx)
	defer unsubscribe()
	ref := resourcemodel.ResourceRef{ClusterID: svc.clusterID, Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Namespace: "argocd"}
	objects := config.ObjectCatalogWatchPendingBufferSize + 1
	for i := range objects {
		ref.Name = fmt.Sprintf("secret-%d", i)
		source.listener(ref)
	}
	// Repeat one identity across recreation while startup cannot drain events.
	for range objects {
		ref.UID = "old-uid"
		source.listener(ref)
		ref.UID = "replacement-uid"
		source.listener(ref)
	}
	ref.Name = "deleted"
	source.listener(ref)
	_, recovery := notifier.takeFullSyncRequest()
	require.False(t, recovery, "initial watch replay must not schedule another full catalog LIST")

	done := make(chan struct{})
	go func() {
		notifier.run(ctx)
		close(done)
	}()
	t.Cleanup(func() { cancel(); <-done })
	require.Eventually(t, func() bool { return svc.Query(QueryOptions{}).TotalItems == objects }, 3*time.Second, 10*time.Millisecond)
	cancel()
	<-done
	require.EqualValues(t, objects+1, reads.Load(), "read each distinct identity once, including authoritative absence")
	rows := svc.Query(QueryOptions{}).Items
	require.NotEmpty(t, rows)
	require.Equal(t, "current-uid", rows[0].Ref.UID)
	require.Equal(t, "current", rows[0].ResourceVersion)
}

func TestQueuedCustomChangeUsesCurrentIdentityAndRecoversUnreadySource(t *testing.T) {
	for _, version := range []string{"v1", "v1beta1"} {
		t.Run(version, func(t *testing.T) {
			testQueuedCustomChange(t, version)
		})
	}
}

func testQueuedCustomChange(t *testing.T, watchVersion string) {
	t.Helper()
	svc := newTestWatchService()
	desc := Descriptor{Group: "external-secrets.io", Version: "v1", Kind: "ExternalSecret", Resource: "externalsecrets", Namespaced: true, Scope: ScopeNamespace}
	registerDesc(svc, desc)
	ref := resourcemodel.ResourceRef{ClusterID: svc.clusterID, Group: desc.Group, Version: watchVersion, Kind: desc.Kind, Resource: desc.Resource, Namespace: "argocd", Name: "argocd-saml", UID: "old-uid"}
	object := &unstructured.Unstructured{}
	object.SetName(ref.Name)
	object.SetNamespace(ref.Namespace)
	object.SetUID("replacement-uid")
	object.SetResourceVersion("new")
	source := &catalogWatchSourceStub{object: object, ready: true}
	svc.deps.CustomResourceSource = source
	notifier := newWatchNotifier(svc)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	unsubscribe := notifier.subscribeCustomResources(ctx)
	defer unsubscribe()
	source.listener(ref)
	events := notifier.takeCustomResourceEvents()
	require.Len(t, events, 1)
	event := events[0]
	notifier.flush([]watchEvent{event})
	rows := svc.Query(QueryOptions{}).Items
	require.Len(t, rows, 1)
	require.Equal(t, "replacement-uid", rows[0].Ref.UID)
	require.Equal(t, desc.Version, rows[0].Ref.Version, "catalog rows retain discovery's preferred version")
	_, recovery := notifier.takeFullSyncRequest()
	require.False(t, recovery, "a different watch version must not require a full catalog LIST")

	// A full sync holding publication ownership cannot lose an update.
	svc.syncMu.Lock()
	notifier.flush([]watchEvent{event})
	svc.syncMu.Unlock()
	_, recovery = notifier.takeFullSyncRequest()
	require.True(t, recovery)
	source.ready = false
	notifier.flush([]watchEvent{event})
	_, recovery = notifier.takeFullSyncRequest()
	require.True(t, recovery)
	require.Len(t, svc.Query(QueryOptions{}).Items, 1, "an unready watch cannot erase retained membership")
	source.ready = true
	source.object = nil
	notifier.flush([]watchEvent{event})
	require.Empty(t, svc.Query(QueryOptions{}).Items)
	_, recovery = notifier.takeFullSyncRequest()
	require.False(t, recovery, "deletion must remove the catalog-version key without a full LIST")

	other := ref
	other.ClusterID = "other-cluster"
	source.listener(other)
	require.Empty(t, notifier.takeCustomResourceEvents())
	cancel()
	source.listener(ref)
	require.Empty(t, notifier.takeCustomResourceEvents())
}
