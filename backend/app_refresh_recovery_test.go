package backend

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

func TestTeardownRefreshSubsystem(t *testing.T) {
	app := newTestAppWithDefaults(t)

	cancelled := false
	app.refreshCancel = func() { cancelled = true }

	setRefreshServiceReadyForTest(app)

	app.teardownRefreshSubsystem()

	require.True(t, cancelled)
	require.Nil(t, app.refreshService.Load())
}

func TestShutdownRefreshSubsystemCancelsPartialGenerationWithoutManager(t *testing.T) {
	app := newTestAppWithDefaults(t)
	subsystem := &system.Subsystem{}
	preparationCtx, started := subsystem.BeginColdPreparation(context.Background(), time.Now())
	require.True(t, started)

	app.shutdownRefreshSubsystem(subsystem)

	require.ErrorIs(t, preparationCtx.Err(), context.Canceled,
		"global teardown must cancel work owned by a partially built subsystem generation")
}

func TestTeardownRefreshSubsystemBlocksRuntimeResurrectionUntilSetup(t *testing.T) {
	app := newTestAppWithDefaults(t)
	setTestAppRuntimeReady(t, app, context.Background())
	require.NotNil(t, app.ensureRefreshRuntimeContext())

	app.teardownRefreshSubsystem()
	require.Nil(t, app.ensureRefreshRuntimeContext(),
		"a late auth or governor rebuild must not resurrect the process refresh runtime after teardown")

	require.NotNil(t, app.beginRefreshRuntimeContext(),
		"a new selection setup must explicitly reopen the process refresh runtime")
	require.NotNil(t, app.ensureRefreshRuntimeContext())
	app.teardownRefreshSubsystem()
}

func TestTeardownRefreshSubsystemCoordinatesWithConcurrentRuntimeEnsure(t *testing.T) {
	app := newTestAppWithDefaults(t)
	setTestAppRuntimeReady(t, app, context.Background())
	require.NotNil(t, app.ensureRefreshRuntimeContext())

	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		app.selectionMutationMu.Lock()
		defer app.selectionMutationMu.Unlock()
		<-start
		app.teardownRefreshSubsystem()
	}()
	go func() {
		defer wg.Done()
		app.governorReconcileMu.Lock()
		defer app.governorReconcileMu.Unlock()
		<-start
		app.ensureRefreshRuntimeContext()
	}()
	close(start)
	wg.Wait()

	require.Nil(t, app.ensureRefreshRuntimeContext(),
		"teardown must remain authoritative over a concurrent late runtime ensure")
}

func TestRefreshCoordinatorResetRuntimeStateUnpublishesAndClearsCache(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)
	setRefreshServiceReadyForTest(app)
	cacheRoot, err := app.preferences.cacheDirPath()
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(cacheRoot, "spill"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(cacheRoot, "spill", "cached"), []byte("x"), 0o600))

	require.NoError(t, app.RefreshCoordinator.ResetRuntimeState())
	require.Nil(t, app.refreshService.Load())
	require.NoDirExists(t, cacheRoot)

	require.NoError(t, app.RefreshCoordinator.ResetRuntimeState(), "reset must be repeatable")
}

// TestHandlePermissionIssuesLogsWarning verifies that permission issues are logged
// without triggering global auth recovery (per-cluster recovery is now used).
func TestHandlePermissionIssuesLogsWarning(t *testing.T) {
	app := newTestAppWithDefaults(t)

	issues := []system.PermissionIssue{{Domain: "namespace", Resource: "pods", Err: errors.New("forbidden")}}
	app.handlePermissionIssues(issues)

	entries := app.appLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Refresh domain namespace unavailable (pods)")
}

// TestHandlePermissionIssuesSkipsNilErrors verifies that permission issues
// with nil errors are skipped without logging.
func TestHandlePermissionIssuesSkipsNilErrors(t *testing.T) {
	app := newTestAppWithDefaults(t)

	issues := []system.PermissionIssue{{Domain: "namespace", Resource: "pods", Err: nil}}
	app.handlePermissionIssues(issues)

	entries := app.appLogs.logger.GetEntries()
	require.Empty(t, entries)
}

// TestPerClusterTransportFailure verifies that transport failure tracking is
// isolated per cluster. Failures in one cluster should not affect another.
func TestPerClusterTransportFailure(t *testing.T) {
	app := newTestAppWithDefaults(t)

	// Record failures for cluster A
	app.recordClusterTransportFailure("cluster-a", "test failure", nil)
	app.recordClusterTransportFailure("cluster-a", "test failure", nil)

	// Cluster B should be unaffected
	stateA := app.getTransportState("cluster-a")
	stateB := app.getTransportState("cluster-b")

	require.Equal(t, 2, stateA.failureCount)
	require.Equal(t, 0, stateB.failureCount)
}

// TestPerClusterTransportSuccessResets verifies that recording a success for
// one cluster resets its failure count without affecting other clusters.
func TestPerClusterTransportSuccessResets(t *testing.T) {
	app := newTestAppWithDefaults(t)

	// Record failures for both clusters
	app.recordClusterTransportFailure("cluster-a", "failure", nil)
	app.recordClusterTransportFailure("cluster-a", "failure", nil)
	app.recordClusterTransportFailure("cluster-b", "failure", nil)

	// Reset cluster A
	app.recordClusterTransportSuccess("cluster-a")

	stateA := app.getTransportState("cluster-a")
	stateB := app.getTransportState("cluster-b")

	require.Equal(t, 0, stateA.failureCount)
	require.Equal(t, 1, stateB.failureCount)
}

// TestPerClusterTransportStateInitialization verifies that getTransportState
// lazily initializes state for new clusters.
func TestPerClusterTransportStateInitialization(t *testing.T) {
	app := newTestAppWithDefaults(t)

	state := app.getTransportState("new-cluster")
	require.NotNil(t, state)
	require.Equal(t, 0, state.failureCount)
	require.False(t, state.rebuildInProgress)
}

// TestPerClusterTransportWindowReset verifies that the failure window resets
// after the window duration expires.
func TestPerClusterTransportWindowReset(t *testing.T) {
	app := newTestAppWithDefaults(t)

	// Record a failure
	app.recordClusterTransportFailure("cluster-a", "failure", nil)

	stateA := app.getTransportState("cluster-a")
	require.Equal(t, 1, stateA.failureCount)

	// Manually expire the window by setting windowStart in the past
	stateA.mu.Lock()
	stateA.windowStart = time.Now().Add(-31 * time.Second)
	stateA.mu.Unlock()

	// Record another failure - should reset the count first
	app.recordClusterTransportFailure("cluster-a", "failure", nil)

	stateA.mu.Lock()
	count := stateA.failureCount
	stateA.mu.Unlock()

	// The count should be 1 (reset + 1 new failure), not 2
	require.Equal(t, 1, count)
}

// TestPerClusterTransportRebuildTriggersAtThreshold verifies that reaching
// the failure threshold triggers a rebuild for that specific cluster.
func TestPerClusterTransportRebuildTriggersAtThreshold(t *testing.T) {
	app := newTestAppWithDefaults(t)

	// Record 3 failures (threshold) for cluster A
	app.recordClusterTransportFailure("cluster-a", "test", nil)
	app.recordClusterTransportFailure("cluster-a", "test", nil)
	app.recordClusterTransportFailure("cluster-a", "test", nil)

	stateA := app.getTransportState("cluster-a")
	stateA.mu.Lock()
	inProgress := stateA.rebuildInProgress
	stateA.mu.Unlock()

	// Rebuild should be triggered (or just triggered)
	// Note: The rebuild runs asynchronously so we can't check completion here
	require.True(t, inProgress || stateA.failureCount == 0, "expected rebuild to be triggered or already completed")
}

// TestPerClusterTransportRebuildCooldown verifies that the cooldown period
// prevents rapid successive rebuilds for the same cluster.
func TestPerClusterTransportRebuildCooldown(t *testing.T) {
	app := newTestAppWithDefaults(t)

	stateA := app.getTransportState("cluster-a")
	// Simulate a recent rebuild
	stateA.mu.Lock()
	stateA.lastRebuild = time.Now()
	stateA.mu.Unlock()

	// Record 3 failures (threshold)
	app.recordClusterTransportFailure("cluster-a", "test", nil)
	app.recordClusterTransportFailure("cluster-a", "test", nil)
	app.recordClusterTransportFailure("cluster-a", "test", nil)

	stateA.mu.Lock()
	inProgress := stateA.rebuildInProgress
	count := stateA.failureCount
	stateA.mu.Unlock()

	// Rebuild should NOT be triggered due to cooldown
	require.False(t, inProgress, "rebuild should not trigger during cooldown")
	require.Equal(t, 3, count, "failure count should still be tracked")
}
