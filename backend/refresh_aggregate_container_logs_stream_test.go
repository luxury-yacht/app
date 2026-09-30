package backend

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

func TestAggregateContainerLogsStreamHandlerRoutesFirstFrameByCluster(t *testing.T) {
	handlerA := &containerlogsstream.Handler{}
	handlerB := &containerlogsstream.Handler{}
	aggregate := newAggregateContainerLogsStreamHandler(map[string]*system.Subsystem{
		"cluster-a": {ContainerLogs: handlerA},
		"cluster-b": {ContainerLogs: handlerB},
	})

	clusterID, err := aggregate.selectCluster([]string{"cluster-b"})
	require.NoError(t, err)
	require.Equal(t, "cluster-b", clusterID)
	require.Same(t, handlerB, aggregate.handlers[clusterID])
	require.NotSame(t, handlerA, aggregate.handlers[clusterID])
}

func TestAggregateContainerLogsStreamHandlerRequiresOneCluster(t *testing.T) {
	aggregate := newAggregateContainerLogsStreamHandler(nil)

	_, err := aggregate.selectCluster(nil)
	require.EqualError(t, err, "container logs stream requires a single cluster scope")
	_, err = aggregate.selectCluster([]string{"cluster-a", "cluster-b"})
	require.EqualError(t, err, "container logs stream requires a single cluster scope")
}

// scriptedContainerLogsConn is a container-logs stream connection whose first
// client frame is fixed and whose sent frames are recorded.
type scriptedContainerLogsConn struct {
	request  string
	payloads []containerlogsstream.EventPayload
}

func (c *scriptedContainerLogsConn) ReceiveJSON(v any) error {
	return json.Unmarshal([]byte(c.request), v)
}

func (c *scriptedContainerLogsConn) SendJSON(v interface{}) error {
	c.payloads = append(c.payloads, v.(containerlogsstream.EventPayload))
	return nil
}

func (c *scriptedContainerLogsConn) Context() context.Context { return context.Background() }

// A Logs tab that connects while the refresh subsystem is being rebuilt, or
// before its cluster's handler is published, retries; a request that can never
// be served does not.
func TestContainerLogsStreamRoutingErrorsSayWhetherARetryCanHelp(t *testing.T) {
	routed := &refreshAggregateHandlers{containerLogs: newAggregateContainerLogsStreamHandler(nil)}
	tests := []struct {
		name       string
		aggregates *refreshAggregateHandlers
		request    string
		retryable  bool
	}{
		{name: "refresh subsystem not published", request: `{"scope":"cluster-a|default:/v1:Pod:web"}`, retryable: true},
		{name: "cluster handler not published", aggregates: routed, request: `{"scope":"cluster-a|default:/v1:Pod:web"}`, retryable: true},
		{name: "scope without one cluster", aggregates: routed, request: `{"scope":"default:/v1:Pod:web"}`, retryable: false},
		{name: "undecodable request", aggregates: routed, request: `{"scope":`, retryable: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			coordinator := &RefreshCoordinator{}
			if tt.aggregates != nil {
				coordinator.refreshAggregates.Store(tt.aggregates)
			}
			conn := &scriptedContainerLogsConn{request: tt.request}

			coordinator.serveContainerLogsStream(conn)

			require.Len(t, conn.payloads, 1)
			require.NotEmpty(t, conn.payloads[0].Error)
			require.Equal(t, tt.retryable, conn.payloads[0].Retryable, conn.payloads[0].Error)
		})
	}
}
