package backend

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestClusterRuntimeIntentQueueCoalescesLatestIntentWithoutBlockingPublisher(t *testing.T) {
	queue := newClusterRuntimeIntentQueue()

	publishDone := make(chan struct{})
	go func() {
		for generation := uint64(1); generation <= 1_000; generation++ {
			queue.Publish(ClusterRuntimeIntent{
				Kind:       ClusterRuntimeIntentTransportRebuild,
				ClusterID:  "cluster-a",
				Generation: generation,
			})
		}
		close(publishDone)
	}()

	select {
	case <-publishDone:
	case <-time.After(time.Second):
		t.Fatal("intent publication blocked without a consumer")
	}

	intents := queue.Drain()
	require.Len(t, intents, 1)
	require.Equal(t, uint64(1_000), intents[0].Generation)
}

func TestClusterRuntimeIntentQueueCancellationStopsConsumption(t *testing.T) {
	queue := newClusterRuntimeIntentQueue()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		queue.Consume(ctx, func(ClusterRuntimeIntent) {})
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("intent consumer did not stop after cancellation")
	}
}

func TestClusterRuntimeIntentQueueStopClearsAndRejectsPendingWork(t *testing.T) {
	queue := newClusterRuntimeIntentQueue()
	queue.Publish(ClusterRuntimeIntent{
		Kind: ClusterRuntimeIntentTransportRebuild, ClusterID: "cluster-a", Generation: 1,
	})

	queue.Stop()
	require.Empty(t, queue.Drain())

	queue.Publish(ClusterRuntimeIntent{
		Kind: ClusterRuntimeIntentTransportRebuild, ClusterID: "cluster-a", Generation: 2,
	})
	require.Empty(t, queue.Drain())
}

func TestWorkspaceRejectsStaleClusterRuntimeIntentByKindAndCluster(t *testing.T) {
	workspace := newWorkspaceCoordinator(WorkspaceCoordinatorDependencies{})
	newer := ClusterRuntimeIntent{
		Kind: ClusterRuntimeIntentAuthRebuild, ClusterID: "cluster-a", Generation: 2,
	}
	older := newer
	older.Generation = 1

	require.True(t, workspace.acceptClusterRuntimeIntent(newer))
	require.False(t, workspace.acceptClusterRuntimeIntent(older))
	require.True(t, workspace.clusterRuntimeIntentIsCurrent(newer))
	require.False(t, workspace.clusterRuntimeIntentIsCurrent(older))

	// Generations are compared per intent kind and cluster. An unrelated source
	// or cluster must not make valid work look stale.
	require.True(t, workspace.acceptClusterRuntimeIntent(ClusterRuntimeIntent{
		Kind: ClusterRuntimeIntentTransportRebuild, ClusterID: "cluster-a", Generation: 1,
	}))
	require.True(t, workspace.acceptClusterRuntimeIntent(ClusterRuntimeIntent{
		Kind: ClusterRuntimeIntentAuthRebuild, ClusterID: "cluster-b", Generation: 1,
	}))
}
