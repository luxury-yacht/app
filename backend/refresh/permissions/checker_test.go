package permissions

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCheckerUsesCacheUntilExpiry(t *testing.T) {
	callCount := 0
	checker := NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string) (bool, error) {
		callCount++
		return true, nil
	})

	now := time.Date(2024, 5, 1, 10, 0, 0, 0, time.UTC)
	checker.now = func() time.Time { return now }

	decision, err := checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceFresh, decision.Source)
	require.Equal(t, 1, callCount)

	decision, err = checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceCache, decision.Source)
	require.Equal(t, 1, callCount)

	now = now.Add(2 * time.Minute)
	decision, err = checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceFresh, decision.Source)
	require.Equal(t, 2, callCount)
}

func TestCheckerFallsBackOnTransientError(t *testing.T) {
	callCount := 0
	checker := NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string) (bool, error) {
		callCount++
		if callCount == 1 {
			return true, nil
		}
		return false, context.DeadlineExceeded
	})

	now := time.Date(2024, 5, 1, 11, 0, 0, 0, time.UTC)
	checker.now = func() time.Time { return now }

	decision, err := checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceFresh, decision.Source)

	now = now.Add(2 * time.Minute)
	decision, err = checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceFallback, decision.Source)
	require.True(t, decision.Allowed)
}

func TestCheckerReturnsErrorWithoutCacheOnTransient(t *testing.T) {
	checker := NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string) (bool, error) {
		return false, context.DeadlineExceeded
	})

	_, err := checker.Can(context.Background(), "", "pods", "list")
	require.Error(t, err)
}

func TestCheckerCacheKeyIncludesClusterID(t *testing.T) {
	checker := NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string) (bool, error) {
		return true, nil
	})

	key, err := checker.cacheKey("", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, "cluster-a|/pods/list", key)
}

func TestCheckerDeduplicatesConcurrentCalls(t *testing.T) {
	// Track how many actual SSAR review calls occur.
	var reviewCalls int64
	// Use a barrier to ensure all goroutines call Can() concurrently.
	ready := make(chan struct{})

	checker := NewCheckerWithReview("cluster-b", time.Minute, func(ctx context.Context, group, resource, verb string) (bool, error) {
		atomic.AddInt64(&reviewCalls, 1)
		// Small delay to widen the singleflight window.
		time.Sleep(50 * time.Millisecond)
		return true, nil
	})

	const goroutines = 20
	var wg sync.WaitGroup
	wg.Add(goroutines)
	errs := make([]error, goroutines)

	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			<-ready
			_, err := checker.Can(context.Background(), "", "pods", "list")
			errs[idx] = err
		}(i)
	}

	// Release all goroutines at once.
	close(ready)
	wg.Wait()

	for i, err := range errs {
		require.NoError(t, err, fmt.Sprintf("goroutine %d returned error", i))
	}
	// Singleflight should collapse all concurrent callers into a single review call.
	actual := atomic.LoadInt64(&reviewCalls)
	require.Equal(t, int64(1), actual, "expected singleflight to deduplicate concurrent SSAR calls, got %d", actual)
}

func TestCheckerStaleWhileRevalidate(t *testing.T) {
	var callCount int64
	checker := NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string) (bool, error) {
		atomic.AddInt64(&callCount, 1)
		return true, nil
	})

	now := time.Date(2024, 5, 1, 10, 0, 0, 0, time.UTC)
	checker.now = func() time.Time { return now }

	// First call: fresh.
	decision, err := checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceFresh, decision.Source)
	require.Equal(t, int64(1), atomic.LoadInt64(&callCount))

	// Advance past TTL but within stale grace window (TTL=1m, grace=30s -> within 1m30s).
	now = now.Add(time.Minute + 15*time.Second)
	decision, err = checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceStale, decision.Source)
	require.True(t, decision.Allowed)

	// Wait a moment for the background refresh to fire.
	time.Sleep(100 * time.Millisecond)
	require.Equal(t, int64(2), atomic.LoadInt64(&callCount))

	// Next call should get the freshly cached value.
	decision, err = checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceCache, decision.Source)
}

func TestCheckerStaleGracePeriodExpired(t *testing.T) {
	callCount := 0
	checker := NewCheckerWithReview("cluster-a", time.Minute, func(context.Context, string, string, string) (bool, error) {
		callCount++
		return true, nil
	})

	now := time.Date(2024, 5, 1, 10, 0, 0, 0, time.UTC)
	checker.now = func() time.Time { return now }

	// First call: fresh.
	decision, err := checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceFresh, decision.Source)
	require.Equal(t, 1, callCount)

	// Advance past TTL + stale grace (1m + 30s + 1s = 1m31s): should block and fetch fresh.
	now = now.Add(time.Minute + 31*time.Second)
	decision, err = checker.Can(context.Background(), "", "pods", "list")
	require.NoError(t, err)
	require.Equal(t, DecisionSourceFresh, decision.Source)
	require.Equal(t, 2, callCount)
}

func TestCheckerCanListWatch(t *testing.T) {
	t.Run("both allowed", func(t *testing.T) {
		checker := NewCheckerWithReview("cluster-c", time.Minute, func(_ context.Context, _, _, verb string) (bool, error) {
			return true, nil
		})
		require.True(t, checker.CanListWatch("", "pods"))
	})

	t.Run("list denied", func(t *testing.T) {
		checker := NewCheckerWithReview("cluster-c", time.Minute, func(_ context.Context, _, _, verb string) (bool, error) {
			if verb == "list" {
				return false, nil
			}
			return true, nil
		})
		require.False(t, checker.CanListWatch("", "pods"))
	})

	t.Run("watch denied", func(t *testing.T) {
		checker := NewCheckerWithReview("cluster-c", time.Minute, func(_ context.Context, _, _, verb string) (bool, error) {
			if verb == "watch" {
				return false, nil
			}
			return true, nil
		})
		require.False(t, checker.CanListWatch("", "pods"))
	})

	t.Run("list error", func(t *testing.T) {
		checker := NewCheckerWithReview("cluster-c", time.Minute, func(_ context.Context, _, _, verb string) (bool, error) {
			if verb == "list" {
				return false, fmt.Errorf("connection refused")
			}
			return true, nil
		})
		require.False(t, checker.CanListWatch("", "pods"))
	})

	t.Run("nil checker", func(t *testing.T) {
		var checker *Checker
		require.False(t, checker.CanListWatch("", "pods"))
	})
}
