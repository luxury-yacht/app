package backend

import (
	"sync"
	"time"
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

const defaultSlowLoadingThreshold = 10 * time.Second

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
	emitter       func(clusterId, state, previousState string)
	slowThreshold time.Duration
}

// newClusterLifecycle creates a lifecycle tracker with the default 10s slow-loading threshold.
func newClusterLifecycle(emitter func(clusterId, state, previousState string)) *clusterLifecycle {
	return newClusterLifecycleWithSlowThreshold(emitter, defaultSlowLoadingThreshold)
}

// newClusterLifecycleWithSlowThreshold creates a lifecycle tracker with a custom
// slow-loading threshold (useful for testing with shorter durations).
func newClusterLifecycleWithSlowThreshold(
	emitter func(clusterId, state, previousState string),
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
				cl.emitter(clusterId, string(ClusterStateLoadingSlow), string(ClusterStateLoading))
			}
		})
	}

	cl.mu.Unlock()

	if cl.emitter != nil {
		cl.emitter(clusterId, string(state), string(previousState))
	}
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
