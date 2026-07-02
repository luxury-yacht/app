package system

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
)

// Pins the namespaces doorbell wiring shape: the change notifier's broadcast is
// the stream manager's BroadcastNamespacesRefresh, so a namespace change fans a
// SourceObject doorbell to the namespaces domain's subscribers — this is what
// lets the sidebar refetch on push instead of the 2s poll.
func TestNamespaceNotifierBroadcastsDoorbellThroughStreamManager(t *testing.T) {
	manager := resourcestream.NewManager(
		nil,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		nil,
		nil,
	)
	selector, err := resourcestream.ParseStreamSelector("c1", "namespaces", "")
	require.NoError(t, err)
	sub, err := manager.SubscribeSelector(selector)
	require.NoError(t, err)

	notifier := snapshot.NewNamespaceChangeNotifier(nil, snapshot.NewNamespaceWorkloadTracker(nil))
	defer notifier.Stop()
	notifier.SetBroadcast(manager.BroadcastNamespacesRefresh)

	notifier.NamespaceChanged()

	deadline := time.After(3 * time.Second)
	select {
	case update := <-sub.Updates:
		require.Equal(t, "namespaces", update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, resourcestream.SourceObject, update.Source)
		require.Equal(t, resourcestream.SignalChanged, update.Signal)
		require.NotEmpty(t, update.Version)
	case <-deadline:
		t.Fatal("expected a namespaces doorbell update")
	}
}
