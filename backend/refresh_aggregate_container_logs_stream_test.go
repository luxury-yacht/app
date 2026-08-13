package backend

import (
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
