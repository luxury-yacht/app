package backend

import (
	"context"
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
)

func TestPortForwardStartupResultOwnsSessionLifetime(t *testing.T) {
	for _, outcome := range []string{"connected", "failed", "timeout"} {
		t.Run(outcome, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				fixture := newOperationsCoordinatorFixture(t)
				operations := fixture.coordinator
				setTestAppRuntimeReady(t, fixture.runtime.Lifecycle, context.Background())
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				session := &portForwardSessionInternal{
					PortForwardSession: PortForwardSession{
						ID: "starting-session", ClusterID: "cluster-a", Namespace: "default",
						PodName: "pod-1", ContainerPort: 8080, TargetKind: "Pod", TargetVersion: "v1",
						TargetName: "pod-1", Status: PortForwardStatusConnecting, StartedAt: time.Now().Format(time.RFC3339),
					},
					stopChan: make(chan struct{}), readyChan: make(chan error, 1), cancel: cancel,
				}
				lifecycle := operations.portForwardLifecycle()
				require.True(t, lifecycle.registerStarting(session))
				t.Cleanup(func() { lifecycle.stopForRuntime(session.ID, "test cleanup") })
				switch outcome {
				case "connected":
					session.readyChan <- nil
				case "failed":
					session.readyChan <- errors.New("connection rejected")
				}
				id, err := lifecycle.awaitStart(session)
				if outcome == "connected" {
					require.NoError(t, err)
					require.Equal(t, session.ID, id)
					require.NoError(t, ctx.Err())
					require.Same(t, session, lifecycle.get(id))
					require.Len(t, operations.ListRuntimeOperations(), 1)
					return
				}
				require.Error(t, err)
				require.Empty(t, id)
				require.ErrorIs(t, ctx.Err(), context.Canceled, "failed starts must stop retries and release their parent context")
				select {
				case <-session.stopChan:
				default:
					t.Fatal("failed startup left the forwarder running")
				}
				require.Nil(t, lifecycle.get(session.ID))
				require.Empty(t, operations.ListRuntimeOperations())
			})
		})
	}
}
