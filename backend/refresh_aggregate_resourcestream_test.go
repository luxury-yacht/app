/*
 * backend/refresh_aggregate_resourcestream_test.go
 *
 * Tests for the aggregate resource-stream handler's cluster topology updates.
 */

package backend

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

type resourceStreamTestConn struct {
	ctx      context.Context
	incoming chan resourcestream.ClientMessage
	outgoing chan resourcestream.ServerMessage
}

func newResourceStreamTestConn(ctx context.Context) *resourceStreamTestConn {
	return &resourceStreamTestConn{
		ctx: ctx, incoming: make(chan resourcestream.ClientMessage, 8),
		outgoing: make(chan resourcestream.ServerMessage, 16),
	}
}

func (c *resourceStreamTestConn) ReceiveJSON(value interface{}) error {
	select {
	case <-c.ctx.Done():
		return c.ctx.Err()
	case message := <-c.incoming:
		*(value.(*resourcestream.ClientMessage)) = message
		return nil
	}
}

func (c *resourceStreamTestConn) SendJSON(value interface{}) error {
	message, ok := value.(resourcestream.ServerMessage)
	if !ok {
		return errors.New("unexpected resource stream payload")
	}
	select {
	case <-c.ctx.Done():
		return c.ctx.Err()
	case c.outgoing <- message:
		return nil
	}
}

func (*resourceStreamTestConn) Close() error { return nil }

func (c *resourceStreamTestConn) read(t *testing.T) resourcestream.ServerMessage {
	t.Helper()
	select {
	case message := <-c.outgoing:
		return message
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for resource stream message")
		return resourcestream.ServerMessage{}
	}
}

func TestAggregateResourceStreamSessionsSeeClustersAddedAfterConnect(t *testing.T) {
	handler, err := newAggregateResourceStreamHandler(map[string]*system.Subsystem{}, nil, nil)
	require.NoError(t, err)

	adapter := handler.sessionAdapter()
	selector, err := adapter.ParseSelector("cluster-late", "namespaces", "")
	require.NoError(t, err)
	_, err = adapter.Subscribe(selector)
	require.Error(t, err)

	manager := resourcestream.NewManager(
		nil, nil, nil,
		snapshot.ClusterMeta{ClusterID: "cluster-late", ClusterName: "late"},
		nil, nil,
	)
	require.NoError(t, handler.Update(map[string]*system.Subsystem{
		"cluster-late": {ResourceStream: manager, ClusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-late", ClusterName: "late"}},
	}))

	sub, err := adapter.Subscribe(selector)
	require.NoError(t, err)
	require.NotNil(t, sub)
	sub.Cancel()
}

func TestAggregateResourceStreamExistingSubscriptionFollowsManagerReplacement(t *testing.T) {
	const clusterID = "cluster-rewarmed"
	clusterMeta := snapshot.ClusterMeta{ClusterID: clusterID, ClusterName: "rewarmed"}
	oldManager := resourcestream.NewManager(nil, nil, nil, clusterMeta, nil, nil)
	handler, err := newAggregateResourceStreamHandler(map[string]*system.Subsystem{
		clusterID: {ResourceStream: oldManager, ClusterMeta: clusterMeta},
	}, nil, nil)
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	conn := newResourceStreamTestConn(ctx)
	go handler.Handle(ctx, conn)

	subscribe := resourcestream.ClientMessage{
		Type: resourcestream.MessageTypeRequest, ClusterID: clusterID, Domain: "namespaces",
	}
	conn.incoming <- subscribe
	require.Equal(t, resourcestream.MessageTypeAck, conn.read(t).Type)
	require.Equal(t, resourcestream.MessageTypeReset, conn.read(t).Type)

	newManager := resourcestream.NewManager(nil, nil, nil, clusterMeta, nil, nil)
	require.NoError(t, handler.Update(map[string]*system.Subsystem{
		clusterID: {ResourceStream: newManager, ClusterMeta: clusterMeta},
	}))
	require.Equal(t, resourcestream.MessageTypeComplete, conn.read(t).Type)

	conn.incoming <- subscribe
	require.Equal(t, resourcestream.MessageTypeAck, conn.read(t).Type)
	require.Equal(t, resourcestream.MessageTypeReset, conn.read(t).Type)

	newManager.BroadcastNamespacesRefresh("ns-1", "namespace object changed")
	update := conn.read(t)
	require.Equal(t, resourcestream.MessageTypeModified, update.Type)
	require.Equal(t, clusterID, update.ClusterID)
	require.Equal(t, "namespaces", update.Domain)
	require.Equal(t, "ns-1", update.Version)
}
