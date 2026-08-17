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
	app := newWorkspaceCoordinatorTestFixture(t)

	cancelled := false
	app.Refresh.refreshCancel = func() { cancelled = true }

	setRefreshServiceReadyForTest(app.Refresh)

	app.Refresh.teardownRefreshSubsystem()

	require.True(t, cancelled)
	require.Nil(t, app.Refresh.refreshService.Load())
}

func TestShutdownRefreshSubsystemCancelsPartialGenerationWithoutManager(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	subsystem := &system.Subsystem{}
	preparationCtx, started := subsystem.BeginColdPreparation(context.Background(), time.Now())
	require.True(t, started)

	app.Refresh.shutdownRefreshSubsystem(subsystem)

	require.ErrorIs(t, preparationCtx.Err(), context.Canceled,
		"global teardown must cancel work owned by a partially built subsystem generation")
}

func TestTeardownRefreshSubsystemBlocksRuntimeResurrectionUntilSetup(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	require.NotNil(t, app.Refresh.ensureRefreshRuntimeContext())

	app.Refresh.teardownRefreshSubsystem()
	require.Nil(t, app.Refresh.ensureRefreshRuntimeContext(),
		"a late auth or governor rebuild must not resurrect the process refresh runtime after teardown")

	require.NotNil(t, app.Refresh.beginRefreshRuntimeContext(),
		"a new selection setup must explicitly reopen the process refresh runtime")
	require.NotNil(t, app.Refresh.ensureRefreshRuntimeContext())
	app.Refresh.teardownRefreshSubsystem()
}

func TestTeardownRefreshSubsystemCoordinatesWithConcurrentRuntimeEnsure(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())
	require.NotNil(t, app.Refresh.ensureRefreshRuntimeContext())

	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		app.Workspace.selectionMutationMu.Lock()
		defer app.Workspace.selectionMutationMu.Unlock()
		<-start
		app.Refresh.teardownRefreshSubsystem()
	}()
	go func() {
		defer wg.Done()
		app.Refresh.governorReconcileMu.Lock()
		defer app.Refresh.governorReconcileMu.Unlock()
		<-start
		app.Refresh.ensureRefreshRuntimeContext()
	}()
	close(start)
	wg.Wait()

	require.Nil(t, app.Refresh.ensureRefreshRuntimeContext(),
		"teardown must remain authoritative over a concurrent late runtime ensure")
}

func TestRefreshCoordinatorResetRuntimeStateUnpublishesAndClearsCache(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	setRefreshServiceReadyForTest(app.Refresh)
	cacheRoot, err := app.Preferences.cacheDirPath()
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(cacheRoot, "spill"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(cacheRoot, "spill", "cached"), []byte("x"), 0o600))

	require.NoError(t, app.Refresh.ResetRuntimeState())
	require.Nil(t, app.Refresh.refreshService.Load())
	require.NoDirExists(t, cacheRoot)

	require.NoError(t, app.Refresh.ResetRuntimeState(), "reset must be repeatable")
}

// TestHandlePermissionIssuesLogsWarning verifies that permission issues are logged
// without triggering global auth recovery (per-cluster recovery is now used).
func TestHandlePermissionIssuesLogsWarning(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	issues := []system.PermissionIssue{{Domain: "namespace", Resource: "pods", Err: errors.New("forbidden")}}
	app.Refresh.handlePermissionIssues(issues)

	entries := app.AppLogs.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Refresh domain namespace unavailable (pods)")
}

// TestHandlePermissionIssuesSkipsNilErrors verifies that permission issues
// with nil errors are skipped without logging.
func TestHandlePermissionIssuesSkipsNilErrors(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	issues := []system.PermissionIssue{{Domain: "namespace", Resource: "pods", Err: nil}}
	app.Refresh.handlePermissionIssues(issues)

	entries := app.AppLogs.logger.GetEntries()
	require.Empty(t, entries)
}

// TestPerClusterTransportFailure verifies that transport failure tracking is
// isolated per cluster. Failures in one cluster should not affect another.
func TestPerClusterTransportFailure(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	// Record failures for cluster A
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "test failure", nil)
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "test failure", nil)

	// Cluster B should be unaffected
	stateA := app.ClusterRuntime.getTransportState("cluster-a")
	stateB := app.ClusterRuntime.getTransportState("cluster-b")

	require.Equal(t, 2, stateA.failureCount)
	require.Equal(t, 0, stateB.failureCount)
}

// TestPerClusterTransportSuccessResets verifies that recording a success for
// one cluster resets its failure count without affecting other clusters.
func TestPerClusterTransportSuccessResets(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	// Record failures for both clusters
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "failure", nil)
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "failure", nil)
	app.ClusterRuntime.recordClusterTransportFailure("cluster-b", "failure", nil)

	// Reset cluster A
	app.ClusterRuntime.recordClusterTransportSuccess("cluster-a")

	stateA := app.ClusterRuntime.getTransportState("cluster-a")
	stateB := app.ClusterRuntime.getTransportState("cluster-b")

	require.Equal(t, 0, stateA.failureCount)
	require.Equal(t, 1, stateB.failureCount)
}

// TestPerClusterTransportStateInitialization verifies that getTransportState
// lazily initializes state for new clusters.
func TestPerClusterTransportStateInitialization(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	state := app.ClusterRuntime.getTransportState("new-cluster")
	require.NotNil(t, state)
	require.Equal(t, 0, state.failureCount)
	require.False(t, state.rebuildInProgress)
}

// TestPerClusterTransportWindowReset verifies that the failure window resets
// after the window duration expires.
func TestPerClusterTransportWindowReset(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	// Record a failure
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "failure", nil)

	stateA := app.ClusterRuntime.getTransportState("cluster-a")
	require.Equal(t, 1, stateA.failureCount)

	// Manually expire the window by setting windowStart in the past
	stateA.mu.Lock()
	stateA.windowStart = time.Now().Add(-31 * time.Second)
	stateA.mu.Unlock()

	// Record another failure - should reset the count first
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "failure", nil)

	stateA.mu.Lock()
	count := stateA.failureCount
	stateA.mu.Unlock()

	// The count should be 1 (reset + 1 new failure), not 2
	require.Equal(t, 1, count)
}

// TestPerClusterTransportRebuildTriggersAtThreshold verifies that reaching
// the failure threshold triggers a rebuild for that specific cluster.
func TestPerClusterTransportRebuildTriggersAtThreshold(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)

	// Record 3 failures (threshold) for cluster A
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "test", nil)
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "test", nil)
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "test", nil)

	stateA := app.ClusterRuntime.getTransportState("cluster-a")
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
	app := newWorkspaceCoordinatorTestFixture(t)

	stateA := app.ClusterRuntime.getTransportState("cluster-a")
	// Simulate a recent rebuild
	stateA.mu.Lock()
	stateA.lastRebuild = time.Now()
	stateA.mu.Unlock()

	// Record 3 failures (threshold)
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "test", nil)
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "test", nil)
	app.ClusterRuntime.recordClusterTransportFailure("cluster-a", "test", nil)

	stateA.mu.Lock()
	inProgress := stateA.rebuildInProgress
	count := stateA.failureCount
	stateA.mu.Unlock()

	// Rebuild should NOT be triggered due to cooldown
	require.False(t, inProgress, "rebuild should not trigger during cooldown")
	require.Equal(t, 3, count, "failure count should still be tracked")
}
