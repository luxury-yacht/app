package backend

import (
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/stretchr/testify/require"
)

// emittedEvent records a single state-transition event for test assertions.
type emittedEvent struct {
	clusterId     string
	state         string
	previousState string
}

// collectingEmitter returns an emitter callback and a thread-safe accessor
// for the events it has collected.
func collectingEmitter() (func(string, string, string), func() []emittedEvent) {
	var mu sync.Mutex
	var events []emittedEvent
	emitter := func(clusterId, state, previousState string) {
		mu.Lock()
		events = append(events, emittedEvent{clusterId, state, previousState})
		mu.Unlock()
	}
	getter := func() []emittedEvent {
		mu.Lock()
		defer mu.Unlock()
		out := make([]emittedEvent, len(events))
		copy(out, events)
		return out
	}
	return emitter, getter
}

func TestClusterLifecycleFullTransitionSequence(t *testing.T) {
	emitter, getEvents := collectingEmitter()
	cl := newClusterLifecycleWithSlowThreshold(emitter, 50*time.Millisecond)

	cl.SetState("cluster-a", ClusterStateConnecting)
	cl.SetState("cluster-a", ClusterStateConnected)
	cl.SetState("cluster-a", ClusterStateLoading)
	cl.SetState("cluster-a", ClusterStateReady)

	require.Equal(t, ClusterStateReady, cl.GetState("cluster-a"))

	events := getEvents()
	require.Len(t, events, 4)
	require.Equal(t, emittedEvent{"cluster-a", "connecting", ""}, events[0])
	require.Equal(t, emittedEvent{"cluster-a", "connected", "connecting"}, events[1])
	require.Equal(t, emittedEvent{"cluster-a", "loading", "connected"}, events[2])
	require.Equal(t, emittedEvent{"cluster-a", "ready", "loading"}, events[3])
}

func TestClusterLifecycleSlowLoading(t *testing.T) {
	emitter, getEvents := collectingEmitter()
	threshold := 50 * time.Millisecond
	cl := newClusterLifecycleWithSlowThreshold(emitter, threshold)

	cl.SetState("cluster-a", ClusterStateLoading)

	// Wait long enough for the slow timer to fire.
	require.Eventually(t, func() bool {
		return cl.GetState("cluster-a") == ClusterStateLoadingSlow
	}, time.Second, 10*time.Millisecond)

	events := getEvents()
	// Should have the initial Loading event plus the auto-transition to LoadingSlow.
	require.Len(t, events, 2)
	require.Equal(t, emittedEvent{"cluster-a", "loading", ""}, events[0])
	require.Equal(t, emittedEvent{"cluster-a", "loading_slow", "loading"}, events[1])
}

func TestClusterLifecycleSlowTimerCancelledByReady(t *testing.T) {
	emitter, getEvents := collectingEmitter()
	threshold := 100 * time.Millisecond
	cl := newClusterLifecycleWithSlowThreshold(emitter, threshold)

	cl.SetState("cluster-a", ClusterStateLoading)
	// Transition to Ready before the slow threshold fires.
	cl.SetState("cluster-a", ClusterStateReady)

	// Wait past the threshold to confirm no slow event fires.
	time.Sleep(threshold + 50*time.Millisecond)

	require.Equal(t, ClusterStateReady, cl.GetState("cluster-a"))

	events := getEvents()
	require.Len(t, events, 2)
	require.Equal(t, emittedEvent{"cluster-a", "loading", ""}, events[0])
	require.Equal(t, emittedEvent{"cluster-a", "ready", "loading"}, events[1])
}

func TestClusterLifecycleGetAllStates(t *testing.T) {
	emitter, _ := collectingEmitter()
	cl := newClusterLifecycleWithSlowThreshold(emitter, time.Minute)

	cl.SetState("cluster-a", ClusterStateReady)
	cl.SetState("cluster-b", ClusterStateLoading)
	cl.SetState("cluster-c", ClusterStateDisconnected)

	states := cl.GetAllStates()
	require.Len(t, states, 3)
	require.Equal(t, ClusterStateReady, states["cluster-a"])
	require.Equal(t, ClusterStateLoading, states["cluster-b"])
	require.Equal(t, ClusterStateDisconnected, states["cluster-c"])
}

func TestClusterLifecycleRemove(t *testing.T) {
	emitter, _ := collectingEmitter()
	cl := newClusterLifecycleWithSlowThreshold(emitter, time.Minute)

	cl.SetState("cluster-a", ClusterStateLoading)
	cl.Remove("cluster-a")

	require.Equal(t, ClusterLifecycleState(""), cl.GetState("cluster-a"))
	require.Empty(t, cl.GetAllStates())
}

func TestClusterLifecycleUnknownClusterReturnsEmpty(t *testing.T) {
	emitter, _ := collectingEmitter()
	cl := newClusterLifecycleWithSlowThreshold(emitter, time.Minute)

	require.Equal(t, ClusterLifecycleState(""), cl.GetState("does-not-exist"))
}

func TestClusterLifecycleConcurrentAccess(t *testing.T) {
	emitter, _ := collectingEmitter()
	cl := newClusterLifecycleWithSlowThreshold(emitter, 20*time.Millisecond)

	var wg sync.WaitGroup
	clusterCount := 10
	transitionsPerCluster := 50

	for i := 0; i < clusterCount; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			clusterId := "cluster-" + string(rune('a'+id))
			states := []ClusterLifecycleState{
				ClusterStateConnecting,
				ClusterStateConnected,
				ClusterStateLoading,
				ClusterStateReady,
				ClusterStateDisconnected,
			}
			for j := 0; j < transitionsPerCluster; j++ {
				cl.SetState(clusterId, states[j%len(states)])
			}
		}(i)
	}

	// Concurrent reads while writes are happening.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			_ = cl.GetAllStates()
			_ = cl.GetState("cluster-a")
		}
	}()

	wg.Wait()

	// All clusters should still be tracked.
	states := cl.GetAllStates()
	require.Len(t, states, clusterCount)
}

func TestClusterLifecycleGetAllStatesViaApp(t *testing.T) {
	app := newTestAppWithDefaults(t)

	// nil lifecycle returns nil.
	require.Nil(t, app.GetAllClusterLifecycleStates())

	emitter, _ := collectingEmitter()
	app.clusterLifecycle = newClusterLifecycleWithSlowThreshold(emitter, time.Minute)
	app.clusterLifecycle.SetState("cluster-a", ClusterStateReady)

	states := app.GetAllClusterLifecycleStates()
	require.Len(t, states, 1)
	require.Equal(t, ClusterStateReady, states["cluster-a"])
}

func TestClusterLifecycleDefaultConstructor(t *testing.T) {
	emitter, _ := collectingEmitter()
	cl := newClusterLifecycle(emitter)

	require.Equal(t, config.ClusterLifecycleSlowLoadingThreshold, cl.slowThreshold)
}
