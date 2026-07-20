package backend

import (
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// ClusterLifecycleState represents the current lifecycle phase of a cluster connection.
type ClusterLifecycleState string

const (
	ClusterStateConnecting   ClusterLifecycleState = "connecting"
	ClusterStateAuthFailed   ClusterLifecycleState = "auth_failed"
	ClusterStateConnected    ClusterLifecycleState = "connected"
	ClusterStateLoading      ClusterLifecycleState = "loading"
	ClusterStateLoadingSlow  ClusterLifecycleState = "loading_slow"
	ClusterStateReady        ClusterLifecycleState = "ready"
	ClusterStateDisconnected ClusterLifecycleState = "disconnected"
	ClusterStateReconnecting ClusterLifecycleState = "reconnecting"
)

// clusterLifecycleEntry tracks the current state and any pending slow-loading timer
// for a single cluster.
type clusterLifecycleEntry struct {
	state     ClusterLifecycleState
	slowTimer *time.Timer
}

// clusterLifecycle is a thread-safe per-cluster state machine that tracks lifecycle
// phases and emits events on transitions. When a cluster enters the Loading state,
// a timer is started; if the cluster is still Loading after the threshold, the state
// automatically transitions to LoadingSlow.
type clusterLifecycle struct {
	mu            sync.Mutex
	entries       map[string]*clusterLifecycleEntry
	emitter       func(clusterId string, state, previousState ClusterLifecycleState)
	slowThreshold time.Duration
}

// newClusterLifecycle creates a lifecycle tracker with the default slow-loading threshold.
func newClusterLifecycle(
	emitter func(clusterId string, state, previousState ClusterLifecycleState),
) *clusterLifecycle {
	return newClusterLifecycleWithSlowThreshold(emitter, config.ClusterLifecycleSlowLoadingThreshold)
}

// newClusterLifecycleWithSlowThreshold creates a lifecycle tracker with a custom
// slow-loading threshold (useful for testing with shorter durations).
func newClusterLifecycleWithSlowThreshold(
	emitter func(clusterId string, state, previousState ClusterLifecycleState),
	threshold time.Duration,
) *clusterLifecycle {
	return &clusterLifecycle{
		entries:       make(map[string]*clusterLifecycleEntry),
		emitter:       emitter,
		slowThreshold: threshold,
	}
}

// SetState transitions a cluster to the given state. It cancels any pending slow timer,
// starts a new one if entering Loading, and invokes the emitter callback.
func (cl *clusterLifecycle) SetState(clusterId string, state ClusterLifecycleState) {
	cl.mu.Lock()

	entry := cl.entries[clusterId]
	if entry == nil {
		entry = &clusterLifecycleEntry{}
		cl.entries[clusterId] = entry
	}

	previousState := entry.state
	if isRefreshServingState(previousState) && isClientInitializationState(state) {
		cl.mu.Unlock()
		return
	}

	// Cancel any pending slow-loading timer before changing state.
	if entry.slowTimer != nil {
		entry.slowTimer.Stop()
		entry.slowTimer = nil
	}

	entry.state = state

	// When entering Loading, start a timer that will auto-transition to LoadingSlow
	// if the cluster is still in Loading after the threshold.
	if state == ClusterStateLoading {
		entry.slowTimer = time.AfterFunc(cl.slowThreshold, func() {
			cl.mu.Lock()
			e := cl.entries[clusterId]
			if e == nil || e.state != ClusterStateLoading {
				cl.mu.Unlock()
				return
			}
			e.state = ClusterStateLoadingSlow
			e.slowTimer = nil
			cl.mu.Unlock()

			if cl.emitter != nil {
				cl.emitter(clusterId, ClusterStateLoadingSlow, ClusterStateLoading)
			}
		})
	}

	cl.mu.Unlock()

	if cl.emitter != nil {
		cl.emitter(clusterId, state, previousState)
	}
}

func isClientInitializationState(state ClusterLifecycleState) bool {
	return state == ClusterStateConnecting || state == ClusterStateConnected
}

func isRefreshServingState(state ClusterLifecycleState) bool {
	return state == ClusterStateLoading || state == ClusterStateLoadingSlow || state == ClusterStateReady
}

// GetState returns the current lifecycle state for a cluster.
// Returns an empty string if the cluster is not tracked.
func (cl *clusterLifecycle) GetState(clusterId string) ClusterLifecycleState {
	cl.mu.Lock()
	defer cl.mu.Unlock()

	entry := cl.entries[clusterId]
	if entry == nil {
		return ""
	}
	return entry.state
}

// GetAllStates returns a snapshot map of all tracked cluster states.
func (cl *clusterLifecycle) GetAllStates() map[string]ClusterLifecycleState {
	cl.mu.Lock()
	defer cl.mu.Unlock()

	result := make(map[string]ClusterLifecycleState, len(cl.entries))
	for id, entry := range cl.entries {
		result[id] = entry.state
	}
	return result
}

// Replay emits the cluster's current authoritative state without changing the
// state machine or restarting its slow-loading timer. Foreground activation uses
// this after governor reconciliation so a frontend that missed an earlier edge
// converges even when the backend state itself did not change.
func (cl *clusterLifecycle) Replay(clusterId string) {
	cl.mu.Lock()
	entry := cl.entries[clusterId]
	if entry == nil {
		cl.mu.Unlock()
		return
	}
	state := entry.state
	emitter := cl.emitter
	cl.mu.Unlock()

	if emitter != nil {
		emitter(clusterId, state, state)
	}
}

// Remove deletes a cluster's lifecycle entry and cancels any pending slow timer.
func (cl *clusterLifecycle) Remove(clusterId string) {
	cl.mu.Lock()
	defer cl.mu.Unlock()

	entry := cl.entries[clusterId]
	if entry == nil {
		return
	}
	if entry.slowTimer != nil {
		entry.slowTimer.Stop()
		entry.slowTimer = nil
	}
	delete(cl.entries, clusterId)
}

// GetAllClusterLifecycleStates is the RPC method exposed to Wails for the frontend
// to retrieve the current lifecycle state of every tracked cluster.
func (a *App) GetAllClusterLifecycleStates() map[string]ClusterLifecycleState {
	if a.clusterLifecycle == nil {
		return nil
	}
	return a.clusterLifecycle.GetAllStates()
}
