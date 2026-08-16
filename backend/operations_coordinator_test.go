package backend

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestOperationsCoordinatorStopClusterIsIdempotentAndPreventsLatePortForwardResurrection(t *testing.T) {
	coordinator := NewOperationsCoordinator(OperationsCoordinatorDependencies{
		Context: func() context.Context { return context.Background() },
		EmitEvent: func(string, ...interface{}) {
		},
		Logger: NewLogger(10),
	})
	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            "forward-a",
			ClusterID:     "cluster-a",
			Namespace:     "default",
			TargetKind:    "Pod",
			TargetVersion: "v1",
			TargetName:    "pod-a",
			Status:        PortForwardStatusConnecting,
			StartedAt:     time.Now().Format(time.RFC3339),
		},
		stopChan: make(chan struct{}),
		cancel:   func() {},
	}
	lifecycle := coordinator.portForwardLifecycle()
	lifecycle.registerStarting(session)
	require.Len(t, coordinator.ListRuntimeOperations(), 1)

	coordinator.StopCluster("cluster-a")
	coordinator.StopCluster("cluster-a")
	require.Empty(t, coordinator.ListPortForwards())
	require.Empty(t, coordinator.ListRuntimeOperations())

	coordinator.portForwardSessions[session.ID] = session
	lifecycle.markActive(session, 8080)
	require.Empty(t, coordinator.ListPortForwards())
	require.Empty(t, coordinator.ListRuntimeOperations(), "late workflow state must not resurrect the removed registry entry")
}

func TestOperationsCoordinatorStartupListingAndLiveEventUseTheRegistryEnvelope(t *testing.T) {
	type emittedEvent struct {
		name string
		args []interface{}
	}
	var events []emittedEvent
	coordinator := NewOperationsCoordinator(OperationsCoordinatorDependencies{
		EmitEvent: func(name string, args ...interface{}) {
			events = append(events, emittedEvent{name: name, args: args})
		},
	})

	require.Empty(t, coordinator.ListRuntimeOperations(), "startup listing must come from the empty registry")
	operation := RuntimeOperation{
		ID:        "shell-a",
		Type:      RuntimeOperationShell,
		ClusterID: "cluster-a",
		Target:    runtimeOperationTarget("cluster-a", "", "v1", "Pod", "default", "pod-a"),
		Status:    "open",
		StartedAt: time.Now().Format(time.RFC3339),
	}
	coordinator.registerRuntimeOperation(operation, nil)

	require.NotEmpty(t, events)
	latest := events[len(events)-1]
	require.Equal(t, runtimeOperationsListEventName, latest.name)
	require.Len(t, latest.args, 1)
	payload, ok := latest.args[0].([]RuntimeOperation)
	require.True(t, ok, "runtime-operation list events must retain their typed payload")
	require.Equal(t, []RuntimeOperation{operation}, payload)
}

func TestOperationsCoordinatorShutdownCleansEveryClusterExactlyOnce(t *testing.T) {
	coordinator := NewOperationsCoordinator(OperationsCoordinatorDependencies{
		Context:   func() context.Context { return context.Background() },
		EmitEvent: func(string, ...interface{}) {},
		Logger:    NewLogger(10),
	})

	cleanupCounts := map[string]int{}
	for _, clusterID := range []string{"cluster-a", "cluster-b"} {
		clusterID := clusterID
		coordinator.registerRuntimeOperation(RuntimeOperation{
			ID:        "operation-" + clusterID,
			Type:      RuntimeOperationDrain,
			ClusterID: clusterID,
			Status:    "running",
			StartedAt: time.Now().Format(time.RFC3339),
		}, func(string) error {
			cleanupCounts[clusterID]++
			return nil
		})
	}

	coordinator.Shutdown()
	coordinator.Shutdown()
	coordinator.registerRuntimeOperation(RuntimeOperation{
		ID:        "late-operation",
		Type:      RuntimeOperationShell,
		ClusterID: "cluster-a",
		Status:    "open",
		StartedAt: time.Now().Format(time.RFC3339),
	}, nil)
	require.Empty(t, coordinator.ListRuntimeOperations())
	require.Equal(t, map[string]int{"cluster-a": 1, "cluster-b": 1}, cleanupCounts)
}
