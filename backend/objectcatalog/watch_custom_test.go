package objectcatalog

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

type catalogWatchSourceStub struct {
	object   metav1.Object
	ready    bool
	listener func(resourcemodel.ResourceRef)
}

func (source *catalogWatchSourceStub) SubscribeCustomResourceChanges(listener func(resourcemodel.ResourceRef)) func() {
	source.listener = listener
	return func() { source.listener = nil }
}

func (source *catalogWatchSourceStub) WatchedCustomResource(resourcemodel.ResourceRef) (metav1.Object, bool) {
	return source.object, source.ready
}

func TestQueuedCustomChangeUsesCurrentIdentityAndRecoversUnreadySource(t *testing.T) {
	svc := newTestWatchService()
	desc := Descriptor{Group: "external-secrets.io", Version: "v1", Kind: "ExternalSecret", Resource: "externalsecrets", Namespaced: true, Scope: ScopeNamespace}
	registerDesc(svc, desc)
	ref := resourcemodel.ResourceRef{ClusterID: svc.clusterID, Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Namespace: "argocd", Name: "argocd-saml", UID: "old-uid"}
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
	event := <-notifier.pending
	notifier.flush([]watchEvent{event})
	rows := svc.Query(QueryOptions{}).Items
	require.Len(t, rows, 1)
	require.Equal(t, "replacement-uid", rows[0].Ref.UID)

	// A full sync holding publication ownership cannot lose an update.
	svc.syncMu.Lock()
	notifier.flush([]watchEvent{event})
	svc.syncMu.Unlock()
	_, recovery := notifier.takeFullSyncRequest()
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

	other := ref
	other.ClusterID = "other-cluster"
	source.listener(other)
	require.Empty(t, notifier.pending)
	cancel()
	source.listener(ref)
	require.Empty(t, notifier.pending)
}
