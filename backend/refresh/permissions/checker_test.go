package permissions

import (
	"context"
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
