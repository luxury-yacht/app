package system

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
)

func TestEventSignalObserverBroadcastsEventDoorbells(t *testing.T) {
	manager := resourcestream.NewManager(
		nil,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		nil,
		nil,
	)
	namespaceSelector, err := resourcestream.ParseStreamSelector("c1", "namespace-events", "namespace:prod")
	require.NoError(t, err)
	namespaceSub, err := manager.SubscribeSelector(namespaceSelector)
	require.NoError(t, err)
	clusterSelector, err := resourcestream.ParseStreamSelector("c1", "cluster-events", "cluster")
	require.NoError(t, err)
	clusterSub, err := manager.SubscribeSelector(clusterSelector)
	require.NoError(t, err)

	observer := eventSignalObserver(manager)
	observer("namespace:prod", 7)
	observer("cluster", 8)

	namespaceUpdate := requireSystemDoorbellUpdate(t, namespaceSub)
	require.Equal(t, "namespace-events", namespaceUpdate.Domain)
	require.Equal(t, "namespace:prod", namespaceUpdate.Scope)
	require.Equal(t, resourcestream.SourceEvent, namespaceUpdate.Source)
	require.Equal(t, "7", namespaceUpdate.Version)

	clusterUpdate := requireSystemDoorbellUpdate(t, clusterSub)
	require.Equal(t, "cluster-events", clusterUpdate.Domain)
	require.Equal(t, "", clusterUpdate.Scope)
	require.Equal(t, resourcestream.SourceEvent, clusterUpdate.Source)
	require.Equal(t, "8", clusterUpdate.Version)
}

func requireSystemDoorbellUpdate(t *testing.T, sub *resourcestream.Subscription) resourcestream.Update {
	t.Helper()
	select {
	case update := <-sub.Updates:
		return update
	case <-time.After(time.Second):
		t.Fatal("expected doorbell update")
		return resourcestream.Update{}
	}
}
