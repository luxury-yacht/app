package backend

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestClusterOperationCoordinatorSameClusterSupersedes(t *testing.T) {
	coord := newClusterOperationCoordinator()

	firstStarted := make(chan struct{})
	firstCanceled := make(chan struct{})
	secondStarted := make(chan struct{})

	var wg sync.WaitGroup
	var firstErr error
	var secondErr error

	wg.Add(1)
	go func() {
		defer wg.Done()
		firstErr = coord.run(context.Background(), "cluster-a", func(ctx context.Context) error {
			close(firstStarted)
			<-ctx.Done()
			close(firstCanceled)
			return ctx.Err()
		})
	}()

	<-firstStarted

	wg.Add(1)
	go func() {
		defer wg.Done()
		secondErr = coord.run(context.Background(), "cluster-a", func(context.Context) error {
			close(secondStarted)
			return nil
		})
	}()

	require.Eventually(t, func() bool {
		select {
		case <-firstCanceled:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)

	require.Eventually(t, func() bool {
		select {
		case <-secondStarted:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)

	wg.Wait()
	require.ErrorIs(t, firstErr, context.Canceled)
	require.NoError(t, secondErr)
}

func TestClusterOperationCoordinatorDifferentClustersRunConcurrently(t *testing.T) {
	coord := newClusterOperationCoordinator()

	release := make(chan struct{})
	startA := make(chan struct{})
	startB := make(chan struct{})
	doneA := make(chan struct{})
	doneB := make(chan struct{})

	go func() {
		_ = coord.run(context.Background(), "cluster-a", func(context.Context) error {
			close(startA)
			<-release
			close(doneA)
			return nil
		})
	}()

	go func() {
		_ = coord.run(context.Background(), "cluster-b", func(context.Context) error {
			close(startB)
			<-release
			close(doneB)
			return nil
		})
	}()

	require.Eventually(t, func() bool {
		select {
		case <-startA:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool {
		select {
		case <-startB:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)

	close(release)

	require.Eventually(t, func() bool {
		select {
		case <-doneA:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
	require.Eventually(t, func() bool {
		select {
		case <-doneB:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
}

func TestAppRunClusterOperationSuppressesCancellation(t *testing.T) {
	app := newClusterRuntimeTestFixture(t)
	app.ClusterRuntime.clusterOps = newClusterOperationCoordinator()

	firstStarted := make(chan struct{})

	var wg sync.WaitGroup
	var firstErr error
	var secondErr error

	wg.Add(1)
	go func() {
		defer wg.Done()
		firstErr = app.ClusterRuntime.runClusterOperation(context.Background(), "cluster-a", func(ctx context.Context) error {
			close(firstStarted)
			<-ctx.Done()
			return ctx.Err()
		})
	}()
	<-firstStarted

	wg.Add(1)
	go func() {
		defer wg.Done()
		secondErr = app.ClusterRuntime.runClusterOperation(context.Background(), "cluster-a", func(context.Context) error {
			return nil
		})
	}()

	wg.Wait()
	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
}

func TestBackgroundClusterOperationYieldsToForegroundWork(t *testing.T) {
	coord := newClusterOperationCoordinator()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started, done := make(chan struct{}), make(chan struct{})
	var active context.Context
	go func() {
		defer close(done)
		_ = coord.run(ctx, "cluster-a", func(opCtx context.Context) error { active = opCtx; close(started); <-opCtx.Done(); return opCtx.Err() })
	}()
	<-started
	ran := false
	require.NoError(t, coord.runWhenIdle(context.Background(), "cluster-a", func(context.Context) error { ran = true; return nil }))
	require.False(t, ran, "background work must leave a busy cluster alone")
	require.NoError(t, active.Err(), "background revalidation must not cancel foreground work")
	require.NoError(t, coord.runWhenIdle(context.Background(), "cluster-b", func(context.Context) error { ran = true; return nil }))
	require.True(t, ran, "another cluster must remain available")
	cancel()
	<-done
	ran = false
	require.NoError(t, coord.runWhenIdle(context.Background(), "cluster-a", func(context.Context) error { ran = true; return nil }))
	require.True(t, ran, "deferred background work must be admitted after foreground completion")
}

func TestQueuedClusterCallbackSurvivesForegroundSupersession(t *testing.T) {
	coord := newClusterOperationCoordinator()
	slot, first, _, cancelFirst := coord.begin(context.Background(), "cluster-a", clusterOperationSupersede)
	defer coord.end("cluster-a", slot, first, cancelFirst)
	_, queued, queuedCtx, cancelQueued := coord.begin(context.Background(), "cluster-a", clusterOperationQueue)
	defer coord.end("cluster-a", slot, queued, cancelQueued)
	_, foreground, _, cancelForeground := coord.begin(context.Background(), "cluster-a", clusterOperationSupersede)
	defer coord.end("cluster-a", slot, foreground, cancelForeground)
	require.NoError(t, queuedCtx.Err(), "admitted callback must retain its opportunity to check current intent and reconcile")
}

func TestQueuedClusterCallbackRunsAfterSupersessionAndHonorsParentCancellation(t *testing.T) {
	for _, cancelParent := range []bool{false, true} {
		t.Run(fmt.Sprint(cancelParent), func(t *testing.T) {
			coord := newClusterOperationCoordinator()
			parent, cancel := context.WithCancel(t.Context())
			defer cancel()
			slot, producer, _, endProducer := coord.begin(t.Context(), "cluster-a", clusterOperationSupersede)
			slot.mu.Lock()
			ran := false
			finished := make(chan error, 1)
			go func() {
				finished <- coord.runWithAdmission(parent, "cluster-a", func(context.Context) error { ran = true; return nil }, clusterOperationQueue)
			}()
			require.Eventually(t, func() bool { coord.mu.Lock(); defer coord.mu.Unlock(); return len(slot.cancels) == 2 }, time.Second, time.Millisecond)
			_, next, _, endNext := coord.begin(t.Context(), "cluster-a", clusterOperationSupersede)
			if cancelParent {
				cancel()
			}
			slot.mu.Unlock()
			err := <-finished
			coord.end("cluster-a", slot, producer, endProducer)
			coord.end("cluster-a", slot, next, endNext)
			if cancelParent {
				require.ErrorIs(t, err, context.Canceled)
				require.False(t, ran)
			} else {
				require.NoError(t, err)
				require.True(t, ran)
			}
		})
	}
}
