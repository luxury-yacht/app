package backend

import (
	"errors"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

// stubListener is a minimal net.Listener implementation for testing.
type stubListener struct {
	closed bool
}

func (s *stubListener) Accept() (net.Conn, error) { return nil, errors.New("not implemented") }
func (s *stubListener) Close() error              { s.closed = true; return nil }
func (s *stubListener) Addr() net.Addr            { return &net.TCPAddr{} }

func TestTeardownRefreshSubsystem(t *testing.T) {
	app := newTestAppWithDefaults(t)

	cancelled := false
	app.refreshCancel = func() { cancelled = true }

	listener := &stubListener{}
	app.refreshListener = listener
	app.refreshHTTPServer = &http.Server{}
	app.refreshBaseURL = "http://example"

	app.teardownRefreshSubsystem()

	require.True(t, cancelled)
	require.True(t, listener.closed)
	require.Nil(t, app.refreshListener)
	require.Nil(t, app.refreshHTTPServer)
	require.Empty(t, app.refreshBaseURL)
}

// TestHandlePermissionIssuesLogsWarning verifies that permission issues are logged
// without triggering global auth recovery (per-cluster recovery is now used).
func TestHandlePermissionIssuesLogsWarning(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = NewLogger(10)

	issues := []system.PermissionIssue{{Domain: "namespace", Resource: "pods", Err: errors.New("forbidden")}}
	app.handlePermissionIssues(issues)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	require.Contains(t, entries[len(entries)-1].Message, "Refresh domain namespace unavailable (pods)")
}

// TestHandlePermissionIssuesSkipsNilErrors verifies that permission issues
// with nil errors are skipped without logging.
func TestHandlePermissionIssuesSkipsNilErrors(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.logger = NewLogger(10)

	issues := []system.PermissionIssue{{Domain: "namespace", Resource: "pods", Err: nil}}
	app.handlePermissionIssues(issues)

	entries := app.logger.GetEntries()
	require.Empty(t, entries)
}

// TestPerClusterTransportFailure verifies that transport failure tracking is
// isolated per cluster. Failures in one cluster should not affect another.
func TestPerClusterTransportFailure(t *testing.T) {
	app := &App{}
	app.initTransportStates()

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
	app := &App{}
	app.initTransportStates()

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
	app := &App{}
	// Do NOT call initTransportStates - getTransportState should handle nil map

	state := app.getTransportState("new-cluster")
	require.NotNil(t, state)
	require.Equal(t, 0, state.failureCount)
	require.False(t, state.rebuildInProgress)
}

// TestPerClusterTransportWindowReset verifies that the failure window resets
// after the window duration expires.
func TestPerClusterTransportWindowReset(t *testing.T) {
	app := &App{}
	app.initTransportStates()

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
	app := &App{}
	app.initTransportStates()

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
	app := &App{}
	app.initTransportStates()

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

// TestPerClusterAuthRecoveryScheduling verifies that auth recovery scheduling
// is tracked per-cluster, allowing independent scheduling without conflicts.
func TestPerClusterAuthRecoveryScheduling(t *testing.T) {
	app := &App{}
	app.initAuthRecoveryState()

	// Schedule recovery for cluster A
	scheduled := app.scheduleClusterAuthRecovery("cluster-a")
	require.True(t, scheduled, "first schedule for cluster-a should succeed")

	// Try to schedule again - should return false (already scheduled)
	scheduledAgain := app.scheduleClusterAuthRecovery("cluster-a")
	require.False(t, scheduledAgain, "second schedule for cluster-a should fail")

	// Cluster B should be schedulable independently
	scheduledB := app.scheduleClusterAuthRecovery("cluster-b")
	require.True(t, scheduledB, "cluster-b should be schedulable independently")

	// Clear cluster A and verify it can be scheduled again
	app.clearClusterAuthRecoveryScheduled("cluster-a")
	scheduledAfterClear := app.scheduleClusterAuthRecovery("cluster-a")
	require.True(t, scheduledAfterClear, "cluster-a should be schedulable after clear")

	// Cluster B should still be scheduled (unaffected by cluster A operations)
	scheduledBAgain := app.scheduleClusterAuthRecovery("cluster-b")
	require.False(t, scheduledBAgain, "cluster-b should still be scheduled")
}

// TestPerClusterAuthRecoveryLazyInit verifies that scheduleClusterAuthRecovery
// initializes the map lazily if it hasn't been initialized.
func TestPerClusterAuthRecoveryLazyInit(t *testing.T) {
	app := &App{}
	// Do NOT call initAuthRecoveryState - scheduleClusterAuthRecovery should handle nil map

	scheduled := app.scheduleClusterAuthRecovery("cluster-a")
	require.True(t, scheduled, "should work even without explicit init")
}

// TestPerClusterAuthRecoveryClearNonExistent verifies that clearing a
// non-existent cluster ID doesn't panic or cause issues.
func TestPerClusterAuthRecoveryClearNonExistent(t *testing.T) {
	app := &App{}
	app.initAuthRecoveryState()

	// Should not panic when clearing a cluster that was never scheduled
	require.NotPanics(t, func() {
		app.clearClusterAuthRecoveryScheduled("non-existent-cluster")
	})
}
