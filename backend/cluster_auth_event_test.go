package backend

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/stretchr/testify/require"
)

// TestHandleClusterAuthStateChange_InvalidEmitsAuthFailed verifies that calling
// handleClusterAuthStateChange with StateInvalid causes a "cluster:auth:failed"
// event to be emitted with the correct cluster ID and reason. This is a safety
// net for the code path that notifies the frontend of permanent auth failures.
func TestHandleClusterAuthStateChange_InvalidEmitsAuthFailed(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	// Capture emitted events.
	var emittedEvents []struct {
		name string
		data map[string]any
	}
	var mu sync.Mutex
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		var data map[string]any
		if len(args) > 0 {
			if d, ok := args[0].(map[string]any); ok {
				data = d
			}
		}
		emittedEvents = append(emittedEvents, struct {
			name string
			data map[string]any
		}{name: name, data: data})
	}

	// Set up a cluster so the handler can look up the cluster name.
	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"test-cluster": {
			meta:   ClusterMeta{ID: "test-cluster", Name: "Test Cluster"},
			client: createHealthyClient(),
		},
	}
	app.clusterClientsMu.Unlock()

	// Trigger the StateInvalid handler.
	app.handleClusterAuthStateChange("test-cluster", authstate.StateInvalid, "token expired")

	// Verify the event was emitted.
	mu.Lock()
	defer mu.Unlock()

	var authFailedEvents []map[string]any
	for _, evt := range emittedEvents {
		if evt.name == "cluster:auth:failed" {
			authFailedEvents = append(authFailedEvents, evt.data)
		}
	}

	require.Len(t, authFailedEvents, 1, "should emit exactly one cluster:auth:failed event")
	require.Equal(t, "test-cluster", authFailedEvents[0]["clusterId"])
	require.Equal(t, "Test Cluster", authFailedEvents[0]["clusterName"])
	require.Equal(t, "token expired", authFailedEvents[0]["reason"])
}

// TestHandleClusterAuthStateChange_RecoveringEmitsEvent verifies that
// handleClusterAuthStateChange with StateRecovering emits "cluster:auth:recovering".
func TestHandleClusterAuthStateChange_RecoveringEmitsEvent(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	var emittedEvents []struct {
		name string
		data map[string]any
	}
	var mu sync.Mutex
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		var data map[string]any
		if len(args) > 0 {
			if d, ok := args[0].(map[string]any); ok {
				data = d
			}
		}
		emittedEvents = append(emittedEvents, struct {
			name string
			data map[string]any
		}{name: name, data: data})
	}

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-r": {
			meta:   ClusterMeta{ID: "cluster-r", Name: "Recovering Cluster"},
			client: createHealthyClient(),
		},
	}
	app.clusterClientsMu.Unlock()

	app.handleClusterAuthStateChange("cluster-r", authstate.StateRecovering, "401 unauthorized")

	mu.Lock()
	defer mu.Unlock()

	var recoveringEvents []map[string]any
	for _, evt := range emittedEvents {
		if evt.name == "cluster:auth:recovering" {
			recoveringEvents = append(recoveringEvents, evt.data)
		}
	}

	require.Len(t, recoveringEvents, 1, "should emit exactly one cluster:auth:recovering event")
	require.Equal(t, "cluster-r", recoveringEvents[0]["clusterId"])
	require.Equal(t, "Recovering Cluster", recoveringEvents[0]["clusterName"])
	require.Equal(t, "401 unauthorized", recoveringEvents[0]["reason"])
}

// TestHandleClusterAuthStateChange_ValidEmitsRecoveredEvent verifies that
// handleClusterAuthStateChange with StateValid emits "cluster:auth:recovered".
// The handler also triggers an async subsystem rebuild, but we only verify the event here.
func TestHandleClusterAuthStateChange_ValidEmitsRecoveredEvent(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	var emittedEvents []struct {
		name string
		data map[string]any
	}
	var mu sync.Mutex
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		var data map[string]any
		if len(args) > 0 {
			if d, ok := args[0].(map[string]any); ok {
				data = d
			}
		}
		emittedEvents = append(emittedEvents, struct {
			name string
			data map[string]any
		}{name: name, data: data})
	}

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-v": {
			meta:   ClusterMeta{ID: "cluster-v", Name: "Valid Cluster"},
			client: createHealthyClient(),
		},
	}
	app.clusterClientsMu.Unlock()

	app.handleClusterAuthStateChange("cluster-v", authstate.StateValid, "")

	mu.Lock()
	defer mu.Unlock()

	var recoveredEvents []map[string]any
	for _, evt := range emittedEvents {
		if evt.name == "cluster:auth:recovered" {
			recoveredEvents = append(recoveredEvents, evt.data)
		}
	}

	require.Len(t, recoveredEvents, 1, "should emit exactly one cluster:auth:recovered event")
	require.Equal(t, "cluster-v", recoveredEvents[0]["clusterId"])
	require.Equal(t, "Valid Cluster", recoveredEvents[0]["clusterName"])
}

// TestHandleClusterAuthStateChange_NilAppNoOp verifies the nil-receiver guard.
func TestHandleClusterAuthStateChange_NilAppNoOp(t *testing.T) {
	var app *App
	// Should not panic.
	app.handleClusterAuthStateChange("any-cluster", authstate.StateInvalid, "reason")
}

// TestHandleClusterAuthStateChange_EmptyClusterIDNoOp verifies the empty clusterID guard.
func TestHandleClusterAuthStateChange_EmptyClusterIDNoOp(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	eventCalled := false
	app.eventEmitter = func(_ context.Context, _ string, _ ...interface{}) {
		eventCalled = true
	}

	app.handleClusterAuthStateChange("", authstate.StateInvalid, "reason")
	require.False(t, eventCalled, "no event should be emitted for empty clusterID")
}

// TestHandleClusterAuthRecoveryProgress_CarriesErrorClass verifies that
// recovery progress events expose the latest probe verdict so the frontend
// can distinguish "cluster unreachable, waiting" from a confirmed
// credential failure.
func TestHandleClusterAuthRecoveryProgress_CarriesErrorClass(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	var progressEvents []map[string]any
	var mu sync.Mutex
	app.eventEmitter = func(_ context.Context, name string, args ...interface{}) {
		if name != "cluster:auth:progress" || len(args) == 0 {
			return
		}
		data, ok := args[0].(map[string]any)
		if !ok {
			return
		}
		mu.Lock()
		progressEvents = append(progressEvents, data)
		mu.Unlock()
	}

	app.handleClusterAuthRecoveryProgress("cluster-p", authstate.RecoveryProgress{
		SecondsUntilRetry: 10,
		ErrorClass:        authstate.ErrorClassConnectivity,
	})

	mu.Lock()
	defer mu.Unlock()
	require.Len(t, progressEvents, 1)
	require.Equal(t, "connectivity", progressEvents[0]["errorClass"])
}

// TestGetAllClusterAuthStates_IncludesErrorClass verifies the state RPC
// surfaces the recovery verdict for recovering clusters so a freshly mounted
// frontend can restore the correct presentation.
func TestGetAllClusterAuthStates_IncludesErrorClass(t *testing.T) {
	app := newTestAppWithDefaults(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.Ctx = ctx

	gate := make(chan struct{})
	probeStarted := make(chan struct{}, 8)
	mgr := authstate.New(authstate.Config{
		MaxAttempts:               4,
		BackoffSchedule:           []time.Duration{0, 0, 0, 0},
		ConnectivityRetryInterval: 200 * time.Millisecond,
		ClassifyError: func(error) authstate.ErrorClass {
			return authstate.ErrorClassConnectivity
		},
		RecoveryTest: func() error {
			select {
			case probeStarted <- struct{}{}:
			default:
			}
			select {
			case <-gate:
			default:
			}
			return context.DeadlineExceeded
		},
	})
	defer mgr.Shutdown()
	defer close(gate)

	app.clusterClientsMu.Lock()
	app.clusterClients = map[string]*clusterClients{
		"cluster-s": {
			meta:        ClusterMeta{ID: "cluster-s", Name: "Stuck Cluster"},
			authManager: mgr,
		},
	}
	app.clusterClientsMu.Unlock()

	mgr.ReportFailure("401 Unauthorized")
	<-probeStarted

	require.Eventually(t, func() bool {
		states := app.GetAllClusterAuthStates()
		state, ok := states["cluster-s"]
		if !ok {
			return false
		}
		return state["state"] == "recovering" && state["errorClass"] == "connectivity"
	}, time.Second, 10*time.Millisecond,
		"auth state RPC must expose the recovery verdict")
}
