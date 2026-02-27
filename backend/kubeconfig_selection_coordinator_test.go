package backend

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/stretchr/testify/require"
)

func TestRunSelectionMutationIncrementsGeneration(t *testing.T) {
	app := newTestAppWithDefaults(t)
	before := app.selectionGeneration.Load()

	err := app.runSelectionMutation("unit-test", func(mutation selectionMutation) error {
		require.Equal(t, before+1, mutation.generation)
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, before+1, app.selectionGeneration.Load())
}

func TestRunSelectionMutationDoesNotHoldKubeconfigChangeLockAcrossCallback(t *testing.T) {
	app := newTestAppWithDefaults(t)

	err := app.runSelectionMutation("unit-test", func(_ selectionMutation) error {
		acquired := make(chan struct{})
		go func() {
			app.kubeconfigChangeMu.Lock()
			close(acquired)
			app.kubeconfigChangeMu.Unlock()
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

func TestHandleKubeconfigChangeUsesSelectionMutationBoundary(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	before := app.selectionGeneration.Load()

	app.handleKubeconfigChange([]string{"/tmp/non-existent-kubeconfig"})

	require.Equal(t, before+1, app.selectionGeneration.Load())
}

func TestRunClusterTransportRebuildUsesSelectionMutationBoundary(t *testing.T) {
	app := newTestAppWithDefaults(t)
	before := app.selectionGeneration.Load()

	app.runClusterTransportRebuild("cluster-a", "unit-test", nil)

	require.Equal(t, before+1, app.selectionGeneration.Load())
}

func TestHandleClusterAuthStateChangeUsesSelectionMutationBoundary(t *testing.T) {
	app := newTestAppWithDefaults(t)
	before := app.selectionGeneration.Load()

	app.handleClusterAuthStateChange("cluster-a", authstate.StateRecovering, "unit-test")

	require.Eventually(t, func() bool {
		return app.selectionGeneration.Load() >= before+1
	}, time.Second, 10*time.Millisecond)
}
