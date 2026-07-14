/*
 * backend/app_refresh_subsystems_swap_test.go
 *
 * Tests for per-cluster subsystem replacement.
 */

package backend

import (
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

// TestSwapRefreshSubsystemStopsPrevious pins the auth-rebuild replacement
// contract: storing a rebuilt subsystem for a cluster must STOP the previous
// one. Overwriting the map entry used to leak the old subsystem entirely — its
// informers, reflectors, and namespace notifier kept running on stale
// transports (observed live as duplicate namespaces-doorbell broadcasts to a
// subscriber-less manager).
func TestSwapRefreshSubsystemStopsPrevious(t *testing.T) {
	app := newTestAppWithDefaults(t)

	var mu sync.Mutex
	broadcasts := 0
	notifier := snapshot.NewNamespaceChangeNotifier(nil, snapshot.NewNamespaceWorkloadTracker(nil), nil)
	notifier.SetBroadcast(func(string, string) {
		mu.Lock()
		broadcasts++
		mu.Unlock()
	})

	previous := &system.Subsystem{NamespaceNotifier: notifier}
	next := &system.Subsystem{}

	app.setRefreshSubsystem("cluster-1", previous)
	app.swapRefreshSubsystem("cluster-1", next)

	require.Same(t, next, app.getRefreshSubsystem("cluster-1"), "next subsystem must be stored")

	// The previous subsystem's notifier must be silenced by the swap. The wait
	// must exceed the notifier's 500ms debounce or an unstopped notifier would
	// not have fired yet and the assertion would pass vacuously.
	notifier.NamespaceChanged()
	time.Sleep(700 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	require.Zero(t, broadcasts, "previous subsystem's notifier must be stopped by the swap")
}
