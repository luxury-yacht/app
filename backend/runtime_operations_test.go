package backend

import (
	"context"
	"fmt"
	"testing"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/stretchr/testify/require"
)

func TestCleanupClusterRuntimeOperationsStopsSessionsAndCancelsActiveDrains(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app, context.Background())
	clusterID := fmt.Sprintf("cleanup-%s", t.Name())
	otherClusterID := clusterID + "-other"

	operations.shellSessions = map[string]*shellSession{
		"shell-a": {id: "shell-a", clusterID: clusterID},
		"shell-b": {id: "shell-b", clusterID: otherClusterID},
	}
	operations.portForwardSessions = map[string]*portForwardSessionInternal{
		"pf-a": {
			PortForwardSession: PortForwardSession{ID: "pf-a", ClusterID: clusterID, Status: "active"},
			stopChan:           make(chan struct{}),
		},
		"pf-b": {
			PortForwardSession: PortForwardSession{ID: "pf-b", ClusterID: otherClusterID, Status: "active"},
			stopChan:           make(chan struct{}),
		},
	}
	operations.registerRuntimeOperation(runtimeOperationFromShellSession(operations.shellSessions["shell-a"]), func(reason string) error {
		return operations.closeShellSessionForRuntime("shell-a", reason)
	})
	operations.registerRuntimeOperation(runtimeOperationFromPortForward(operations.portForwardSessions["pf-a"]), func(reason string) error {
		return operations.stopPortForwardForRuntime("pf-a", reason)
	})

	store := nodemaintenance.GlobalStore()
	activeDrain, err := store.StartDrainForClusterIfIdle("node-a-"+t.Name(), types.DrainNodeOptions{}, clusterID, "Cluster A")
	require.NoError(t, err)
	cancelled := false
	store.RegisterCancel(activeDrain.ID, func() { cancelled = true })
	completedDrain := store.StartDrainForCluster("node-b-"+t.Name(), types.DrainNodeOptions{}, clusterID, "Cluster A")
	completedDrain.Complete(nodemaintenance.DrainStatusSucceeded, "done")
	operations.registerRuntimeOperation(runtimeOperationFromDrainJob(activeDrain), func(reason string) error {
		store.CancelDrainForClusterLifecycle(activeDrain.ID, clusterID, reason)
		return nil
	})

	operations.StopCluster(clusterID)

	require.Equal(t, 0, operations.GetClusterShellSessionCount(clusterID))
	require.Equal(t, 1, operations.GetClusterShellSessionCount(otherClusterID))
	require.Equal(t, 0, operations.GetClusterPortForwardCount(clusterID))
	require.Equal(t, 1, operations.GetClusterPortForwardCount(otherClusterID))
	require.True(t, cancelled, "active drain cancel callback should be called")

	cancelledDrain, ok := store.JobForCluster(activeDrain.ID, clusterID)
	require.True(t, ok)
	require.Equal(t, nodemaintenance.DrainStatusCancelled, cancelledDrain.Status)
	require.NotZero(t, cancelledDrain.CompletedAt)

	stillCompleted, ok := store.JobForCluster(completedDrain.ID, clusterID)
	require.True(t, ok)
	require.Equal(t, nodemaintenance.DrainStatusSucceeded, stillCompleted.Status)
}

func TestShutdownCleansRuntimeOperationsForActiveClusters(t *testing.T) {
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app, context.Background())
	clusterID := fmt.Sprintf("shutdown-%s", t.Name())
	app.clusterClients = map[string]*clusterClients{
		clusterID: {meta: ClusterMeta{ID: clusterID, Name: "Cluster"}},
	}
	operations.shellSessions = map[string]*shellSession{
		"shell-a": {id: "shell-a", clusterID: clusterID},
	}
	operations.portForwardSessions = map[string]*portForwardSessionInternal{
		"pf-a": {
			PortForwardSession: PortForwardSession{ID: "pf-a", ClusterID: clusterID, Status: "active"},
			stopChan:           make(chan struct{}),
		},
	}
	operations.registerRuntimeOperation(runtimeOperationFromShellSession(operations.shellSessions["shell-a"]), func(reason string) error {
		return operations.closeShellSessionForRuntime("shell-a", reason)
	})
	operations.registerRuntimeOperation(runtimeOperationFromPortForward(operations.portForwardSessions["pf-a"]), func(reason string) error {
		return operations.stopPortForwardForRuntime("pf-a", reason)
	})
	store := nodemaintenance.GlobalStore()
	activeDrain, err := store.StartDrainForClusterIfIdle("node-a-"+t.Name(), types.DrainNodeOptions{}, clusterID, "Cluster")
	require.NoError(t, err)
	operations.registerRuntimeOperation(runtimeOperationFromDrainJob(activeDrain), func(reason string) error {
		store.CancelDrainForClusterLifecycle(activeDrain.ID, clusterID, reason)
		return nil
	})

	require.NoError(t, app.ServiceShutdown())

	require.Equal(t, 0, operations.GetClusterShellSessionCount(clusterID))
	require.Equal(t, 0, operations.GetClusterPortForwardCount(clusterID))
	cancelledDrain, ok := store.JobForCluster(activeDrain.ID, clusterID)
	require.True(t, ok)
	require.Equal(t, nodemaintenance.DrainStatusCancelled, cancelledDrain.Status)
}

func TestCloseClusterCleansRuntimeOperationsAndUpdatesSelection(t *testing.T) {
	setTestConfigEnv(t)
	fixture := newOperationsCoordinatorFixture(t)
	app := fixture.runtime
	operations := fixture.coordinator
	setTestAppRuntimeReady(t, app, context.Background())

	selection := kubeconfigSelection{Path: "/path/config", Context: "ctx"}
	app.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    selection.Path,
		Context: selection.Context,
	}}
	clusterID := app.clusterMetaForSelection(selection).ID
	app.selectedKubeconfigs = []string{selection.String()}
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    selection.Path,
			kubeconfigContext: selection.Context,
		},
	}
	operations.shellSessions = map[string]*shellSession{
		"shell-a": {id: "shell-a", clusterID: clusterID},
	}
	operations.portForwardSessions = map[string]*portForwardSessionInternal{
		"pf-a": {
			PortForwardSession: PortForwardSession{ID: "pf-a", ClusterID: clusterID, Status: "active"},
			stopChan:           make(chan struct{}),
		},
	}
	operations.registerRuntimeOperation(runtimeOperationFromShellSession(operations.shellSessions["shell-a"]), func(reason string) error {
		return operations.closeShellSessionForRuntime("shell-a", reason)
	})
	operations.registerRuntimeOperation(runtimeOperationFromPortForward(operations.portForwardSessions["pf-a"]), func(reason string) error {
		return operations.stopPortForwardForRuntime("pf-a", reason)
	})

	require.NoError(t, app.CloseCluster(selection.String()))

	require.Empty(t, app.GetSelectedKubeconfigs())
	require.Equal(t, 0, operations.GetClusterShellSessionCount(clusterID))
	require.Equal(t, 0, operations.GetClusterPortForwardCount(clusterID))
}

func TestRuntimeOperationTargetIdentityIsFullObjectReference(t *testing.T) {
	now := "2026-05-17T00:00:00Z"
	session := &portForwardSessionInternal{
		PortForwardSession: PortForwardSession{
			ID:            "pf",
			ClusterID:     "cluster-a",
			ClusterName:   "Cluster A",
			Namespace:     "default",
			TargetGroup:   "apps",
			TargetVersion: "v1",
			TargetKind:    "Deployment",
			TargetName:    "web",
			Status:        "active",
			StartedAt:     now,
		},
	}

	operation := runtimeOperationFromPortForward(session)

	require.NotNil(t, operation.Target)
	require.Equal(t, "cluster-a", operation.Target.ClusterID)
	require.Equal(t, "apps", operation.Target.Group)
	require.Equal(t, "v1", operation.Target.Version)
	require.Equal(t, "Deployment", operation.Target.Kind)
	require.Equal(t, "default", operation.Target.Namespace)
	require.Equal(t, "web", operation.Target.Name)
}
