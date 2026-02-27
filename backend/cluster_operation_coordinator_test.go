package backend

import (
	"context"
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
	app := newTestAppWithDefaults(t)
	app.clusterOps = newClusterOperationCoordinator()

	firstStarted := make(chan struct{})

	var wg sync.WaitGroup
	var firstErr error
	var secondErr error

	wg.Add(1)
	go func() {
		defer wg.Done()
		firstErr = app.runClusterOperation(context.Background(), "cluster-a", func(ctx context.Context) error {
			close(firstStarted)
			<-ctx.Done()
			return ctx.Err()
		})
	}()
	<-firstStarted

	wg.Add(1)
	go func() {
		defer wg.Done()
		secondErr = app.runClusterOperation(context.Background(), "cluster-a", func(context.Context) error {
			return nil
		})
	}()

	wg.Wait()
	require.NoError(t, firstErr)
	require.NoError(t, secondErr)
}
