package resourcestream

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
)

func TestCatalogSourceReadsOnlyAuthorizedCurrentWatchState(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, false)
	dynamic := newWidgetDynamicClient()
	manager := NewManager(nil, nil, nil, snapshot.ClusterMeta{ClusterID: "c1"}, dynamic, nil, "allowed", "denied")
	manager.permissions = &scopedListWatchStub{allowed: map[string]bool{"example.com/widgets|allowed": true}}
	t.Cleanup(manager.Stop)
	ref := resourcemodel.ResourceRef{ClusterID: "c1", Group: "example.com", Version: "v1", Kind: "Widget", Resource: "widgets", Namespace: "allowed", Name: "same-name", UID: "old-uid"}
	_, ready := manager.WatchedCustomResource(ref)
	require.False(t, ready, "no watch must not be interpreted as an authoritative deletion")
	changes := make(chan resourcemodel.ResourceRef, 10)
	unsubscribe := manager.SubscribeCustomResourceChanges(func(ref resourcemodel.ResourceRef) { changes <- ref })
	manager.ensureCustomInformer(customResourceDefinition("widgets.example.com", "example.com", "widgets", "Widget", apiextensionsv1.NamespaceScoped, "1"))
	require.Eventually(t, func() bool { _, ready := manager.WatchedCustomResource(ref); return ready }, time.Second, time.Millisecond)
	object := &unstructured.Unstructured{}
	object.SetGroupVersionKind(schema.GroupVersionKind{Group: ref.Group, Version: ref.Version, Kind: ref.Kind})
	object.SetName(ref.Name)
	object.SetNamespace(ref.Namespace)
	object.SetUID("new-uid")
	gvr := schema.GroupVersionResource{Group: ref.Group, Version: ref.Version, Resource: ref.Resource}
	_, err := dynamic.Resource(gvr).Namespace(ref.Namespace).Create(context.Background(), object, metav1.CreateOptions{})
	require.NoError(t, err)
	select {
	case change := <-changes:
		require.Equal(t, "c1", change.ClusterID)
		require.Equal(t, "new-uid", change.UID)
	case <-time.After(time.Second):
		t.Fatal("catalog subscriber did not receive custom watch update")
	}
	current, ready := manager.WatchedCustomResource(ref)
	require.True(t, ready)
	require.EqualValues(t, "new-uid", current.GetUID(), "an old queued identity must read the current replacement")
	for _, mutate := range []func(*resourcemodel.ResourceRef){
		func(ref *resourcemodel.ResourceRef) { ref.ClusterID = "c2" },
		func(ref *resourcemodel.ResourceRef) { ref.Namespace = "denied" },
		func(ref *resourcemodel.ResourceRef) { ref.Version = "v2" },
		func(ref *resourcemodel.ResourceRef) { ref.Kind = "Other" },
	} {
		wrong := ref
		mutate(&wrong)
		_, ready := manager.WatchedCustomResource(wrong)
		require.False(t, ready)
	}
	unsubscribe()
	unsubscribe()
	require.NoError(t, dynamic.Resource(gvr).Namespace(ref.Namespace).Delete(context.Background(), ref.Name, metav1.DeleteOptions{}))
	require.Eventually(t, func() bool { object, ready := manager.WatchedCustomResource(ref); return ready && object == nil }, time.Second, time.Millisecond)
	manager.Stop()
	_, ready = manager.WatchedCustomResource(ref)
	require.False(t, ready)
	manager.SubscribeCustomResourceChanges(func(resourcemodel.ResourceRef) { t.Error("stopped source admitted a subscriber") })()
	manager.notifyCustomResourceChange(ref)
	require.Empty(t, changes, "retired subscriber must not receive later events")
	for _, action := range dynamic.Actions() {
		if action.GetVerb() == "watch" {
			require.Equal(t, "allowed", action.GetNamespace())
		}
	}
}
