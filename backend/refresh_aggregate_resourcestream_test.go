/*
 * backend/refresh_aggregate_resourcestream_test.go
 *
 * Tests for the aggregate resource-stream handler's cluster topology updates.
 */

package backend

import (
	"testing"

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
