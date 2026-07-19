/*
 * backend/refresh_aggregate_resourcestream_test.go
 *
 * Tests for the aggregate resource-stream handler's cluster topology updates.
 */

package backend

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// TestAggregateResourceStreamSessionsSeeClustersAddedAfterConnect pins the
// live-topology contract: a WebSocket session binds its adapter ONCE, at
// connect time, so the adapter must resolve cluster managers from the
// handler's CURRENT state — not from a map copied at build time. With the
// copied map, a cluster whose subsystem came up after the session connected
// (SSO auth recovery) had every subscribe rejected with "resource stream
// manager not available" forever, leaving the domain permanently unhealthy
// and polling (observed live).
func TestAggregateResourceStreamSessionsSeeClustersAddedAfterConnect(t *testing.T) {
	// Build the handler BEFORE the cluster's subsystem exists (auth pending).
	handler, err := newAggregateResourceStreamHandler(map[string]*system.Subsystem{}, nil, nil)
	require.NoError(t, err)

	// The adapter a session would bind at connect time.
	adapter := handler.sessionAdapter()
	selector, err := adapter.ParseSelector("cluster-late", "namespaces", "")
	require.NoError(t, err)
	_, err = adapter.Subscribe(selector)
	require.Error(t, err, "no manager yet: subscribe is rejected")

	// The cluster's subsystem comes up later (auth recovery) and the app calls
	// Update — the SAME adapter (already bound to live sessions) must now
	// resolve the new manager.
	manager := resourcestream.NewManager(
		nil,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "cluster-late", ClusterName: "late"},
		nil,
		nil,
	)
	require.NoError(t, handler.Update(map[string]*system.Subsystem{
		"cluster-late": {ResourceStream: manager, ClusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-late", ClusterName: "late"}},
	}))

	sub, err := adapter.Subscribe(selector)
	require.NoError(t, err, "existing sessions must see clusters added after they connected")
	require.NotNil(t, sub)
	sub.Cancel()
}

func TestAggregateResourceStreamExistingSubscriptionFollowsManagerReplacement(t *testing.T) {
	const clusterID = "cluster-rewarmed"
	clusterMeta := snapshot.ClusterMeta{ClusterID: clusterID, ClusterName: "rewarmed"}
	oldManager := resourcestream.NewManager(nil, nil, nil, nil, clusterMeta, nil, nil)
	handler, err := newAggregateResourceStreamHandler(map[string]*system.Subsystem{
		clusterID: {ResourceStream: oldManager, ClusterMeta: clusterMeta},
	}, nil, nil)
	require.NoError(t, err)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(time.Second)))

	subscribe := resourcestream.ClientMessage{
		Type:      resourcestream.MessageTypeRequest,
		ClusterID: clusterID,
		Domain:    "namespaces",
	}
	require.NoError(t, conn.WriteJSON(subscribe))
	require.Equal(t, resourcestream.MessageTypeAck, readResourceStreamMessage(t, conn).Type)
	require.Equal(t, resourcestream.MessageTypeReset, readResourceStreamMessage(t, conn).Type)

	newManager := resourcestream.NewManager(nil, nil, nil, nil, clusterMeta, nil, nil)
	require.NoError(t, handler.Update(map[string]*system.Subsystem{
		clusterID: {ResourceStream: newManager, ClusterMeta: clusterMeta},
	}))
	require.Equal(t, resourcestream.MessageTypeComplete, readResourceStreamMessage(t, conn).Type)

	// COMPLETE makes the existing client session re-subscribe. That request must
	// now bind to the replacement manager and establish a new synchronized tail.
	require.NoError(t, conn.WriteJSON(subscribe))
	require.Equal(t, resourcestream.MessageTypeAck, readResourceStreamMessage(t, conn).Type)
	require.Equal(t, resourcestream.MessageTypeReset, readResourceStreamMessage(t, conn).Type)

	newManager.BroadcastNamespacesRefresh("ns-1", "namespace object changed")
	update := readResourceStreamMessage(t, conn)
	require.Equal(t, resourcestream.MessageTypeModified, update.Type)
	require.Equal(t, clusterID, update.ClusterID)
	require.Equal(t, "namespaces", update.Domain)
	require.Equal(t, "ns-1", update.Version)
}

func readResourceStreamMessage(t *testing.T, conn *websocket.Conn) resourcestream.ServerMessage {
	t.Helper()
	var message resourcestream.ServerMessage
	require.NoError(t, conn.ReadJSON(&message))
	return message
}
