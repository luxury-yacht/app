package backend

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/stretchr/testify/require"
)

func TestRunSelectionMutationIncrementsGeneration(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	before := app.Workspace.selectionGeneration.Load()

	err := app.Workspace.runSelectionMutation("unit-test", func(mutation *selectionMutation) error {
		require.Equal(t, before+1, mutation.generation)
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, before+1, app.Workspace.selectionGeneration.Load())
}

func TestRunSelectionMutationDoesNotHoldKubeconfigChangeLockAcrossCallback(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	err := app.Workspace.runSelectionMutation("unit-test", func(_ *selectionMutation) error {
		acquired := make(chan struct{})
		go func() {
			app.Workspace.kubeconfigChangeMu.Lock()
			close(acquired)
			app.Workspace.kubeconfigChangeMu.Unlock()
		}()

		select {
		case <-acquired:
			return nil
		case <-time.After(200 * time.Millisecond):
			t.Fatal("kubeconfigChangeMu appears held across selection mutation callback")
			return nil
		}
	})
	require.NoError(t, err)
}

func TestRunSelectionMutationSupersededGenerationCancelsPriorContext(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	firstStarted := make(chan struct{})
	firstDone := make(chan struct{})
	firstErrCh := make(chan error, 1)

	go func() {
		err := app.Workspace.runSelectionMutation("first", func(mutation *selectionMutation) error {
			close(firstStarted)
			<-mutation.context().Done()
			close(firstDone)
			return mutation.context().Err()
		})
		firstErrCh <- err
	}()

	<-firstStarted

	secondErr := app.Workspace.runSelectionMutation("second", func(*selectionMutation) error {
		return nil
	})
	require.NoError(t, secondErr)

	require.Eventually(t, func() bool {
		select {
		case <-firstDone:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)

	require.NoError(t, <-firstErrCh)
}

func TestHandleKubeconfigChangeUsesSelectionMutationBoundary(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	before := app.Workspace.selectionGeneration.Load()

	app.Workspace.handleKubeconfigChange([]string{"/tmp/non-existent-kubeconfig"})

	require.Equal(t, before+1, app.Workspace.selectionGeneration.Load())
}

func TestRunClusterTransportRebuildUsesSelectionMutationBoundary(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	before := app.Workspace.selectionGeneration.Load()

	app.Workspace.runClusterTransportRebuild("cluster-a", "unit-test", nil)

	require.Equal(t, before+1, app.Workspace.selectionGeneration.Load())
}

func TestHandleClusterAuthStateChangeUsesSelectionMutationBoundary(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	before := app.Workspace.selectionGeneration.Load()

	app.ClusterRuntime.handleClusterAuthStateChange("cluster-a", authstate.StateRecovering, authstate.FailureDiagnostic{Reason: "unit-test"})
	for _, intent := range app.ClusterRuntime.intents.Drain() {
		app.Workspace.consumeClusterRuntimeIntent(intent)
	}

	require.Eventually(t, func() bool {
		return app.Workspace.selectionGeneration.Load() >= before+1
	}, time.Second, 10*time.Millisecond)
}
