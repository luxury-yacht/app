package backend

import (
	"context"
	"testing"
	"testing/synctest"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/types"
)

// Idle and long-running shells must be ended by the backend even when no
// window is attached.
func TestMonitorShellTimeoutEndsExpiredSessions(t *testing.T) {
	for _, tc := range []struct {
		name       string
		keepActive bool
		wait       time.Duration
		reason     string
	}{
		{name: "idle", wait: config.ShellSessionIdleTimeout + config.ShellSessionCleanupInterval, reason: "session idle timeout"},
		{name: "max duration", keepActive: true, wait: config.ShellSessionMaxDuration + config.ShellSessionCleanupInterval, reason: "session exceeded maximum duration"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				fixture := newOperationsCoordinatorFixture(t)
				operations := fixture.coordinator
				setTestAppRuntimeReady(t, fixture.runtime.Lifecycle, context.Background())
				var statuses []ShellStatusEvent
				fixture.runtime.Lifecycle.signalState().eventEmitter = func(_ context.Context, name string, args ...interface{}) {
					if name == shellStatusEventName {
						statuses = append(statuses, args[0].(ShellStatusEvent))
					}
				}
				now := time.Now()
				sess := &shellSession{
					id: "sess", clusterID: "cluster1", startedAt: now, lastActivity: now,
					sizeQueue: newTerminalSizeQueue(), cancel: func() {},
				}
				operations.shellSessions = map[string]*shellSession{sess.id: sess}
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()

				done := make(chan struct{})
				go func() {
					operations.monitorShellTimeout(ctx, sess)
					close(done)
				}()
				deadline := now.Add(tc.wait)
				for time.Now().Before(deadline) {
					time.Sleep(10 * time.Minute)
					if tc.keepActive {
						sess.touchActivity()
					}
				}
				<-done

				if len(statuses) != 1 || statuses[0].Status != types.ShellSessionStatusTimeout || statuses[0].Reason != tc.reason {
					t.Fatalf("status events = %+v, want one timeout with reason %q", statuses, tc.reason)
				}
				if operations.shellSessionLifecycle().get(sess.id) != nil {
					t.Fatal("expired session is still registered")
				}
			})
		})
	}
}
