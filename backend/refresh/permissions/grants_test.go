package permissions

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestGrantsCanListResourceUsesTheCheckerCache(t *testing.T) {
	var reviews atomic.Int32
	grants := NewGrants(NewCheckerWithReview("test", time.Minute, func(context.Context, string, string, string, string) (bool, error) {
		reviews.Add(1)
		return true, nil
	}))

	for range 2 {
		allowed, err := grants.CanListResource(context.Background(), "apps", "deployments")
		require.NoError(t, err)
		require.True(t, allowed)
	}
	require.Equal(t, int32(1), reviews.Load(), "the second check must be served from the checker's cache")
}

func TestGrantsPrimeDeduplicatesRequests(t *testing.T) {
	var reviews atomic.Int32
	grants := NewGrants(NewCheckerWithReview("test", time.Minute, func(context.Context, string, string, string, string) (bool, error) {
		reviews.Add(1)
		return true, nil
	}))
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	require.NoError(t, grants.Prime(ctx, []Request{
		{Group: "", Resource: "nodes", Verb: "list"},
		{Group: "", Resource: "nodes", Verb: "list"},  // duplicate
		{Group: "", Resource: "nodes", Verb: "watch"}, // distinct verb
	}))
	require.Equal(t, int32(2), reviews.Load(), "two unique reviews (list/watch)")
}

func TestGrantsCanListWatchInNamespaceChecksTheExactScope(t *testing.T) {
	var checked []string
	grants := NewGrants(NewCheckerWithReview("test", time.Minute, func(_ context.Context, group, resource, verb, namespace string) (bool, error) {
		checked = append(checked, fmt.Sprintf("%s/%s/%s|%s", group, resource, verb, namespace))
		return namespace == "allowed", nil
	}))

	require.True(t, grants.CanListWatchInNamespace(context.Background(), "example.com", "widgets", "allowed"))
	require.False(t, grants.CanListWatchInNamespace(context.Background(), "example.com", "widgets", "denied"))
	require.Equal(t, []string{
		"example.com/widgets/list|allowed",
		"example.com/widgets/watch|allowed",
		"example.com/widgets/list|denied",
	}, checked)
}

// Revalidation must repeat each check at the scope that produced it: a scoped
// cluster-wide check fans out over the scope again, and an exact-namespace
// check asks that namespace again.
func TestGrantsSnapshotPreservesEvaluationScope(t *testing.T) {
	allows := func(group, resource, namespace string) bool {
		return (group == "apps" && resource == "deployments" && namespace == "team-b") ||
			(group == "example.com" && resource == "widgets" && namespace == "team-a")
	}
	scopeApplies := func(group, resource string) bool { return group == "apps" && resource == "deployments" }
	checker := NewCheckerWithReview("test", time.Minute, func(_ context.Context, group, resource, _, namespace string) (bool, error) {
		return allows(group, resource, namespace), nil
	})
	checker.SetScope([]string{"team-b"}, scopeApplies)
	grants := NewGrants(checker)
	require.True(t, grants.CanListWatchWithContext(context.Background(), "apps", "deployments"))
	require.True(t, grants.CanListWatchInNamespace(context.Background(), "example.com", "widgets", "team-a"))

	var checked []string
	revalidation := NewCheckerWithReview("test", time.Minute, func(_ context.Context, group, resource, verb, namespace string) (bool, error) {
		checked = append(checked, fmt.Sprintf("%s/%s/%s|%s", group, resource, verb, namespace))
		return allows(group, resource, namespace), nil
	})
	revalidation.SetScope([]string{"team-b"}, scopeApplies)

	snapshot := grants.Snapshot()
	require.Len(t, snapshot, 4)
	identities := make([]string, 0, len(snapshot))
	for grant := range snapshot {
		decision, err := grant.Revalidate(context.Background(), revalidation)
		require.NoError(t, err)
		require.True(t, decision.Allowed)
		group, resource, verb := grant.Identity()
		identities = append(identities, fmt.Sprintf("%s/%s/%s", group, resource, verb))
	}
	require.ElementsMatch(t, []string{
		"apps/deployments/list|team-b",
		"apps/deployments/watch|team-b",
		"example.com/widgets/list|team-a",
		"example.com/widgets/watch|team-a",
	}, checked)
	require.ElementsMatch(t, []string{
		"apps/deployments/list",
		"apps/deployments/watch",
		"example.com/widgets/list",
		"example.com/widgets/watch",
	}, identities)
}

func TestGrantsSnapshotIsEmptyBeforeAnyCheck(t *testing.T) {
	var none *Grants
	require.Nil(t, none.Snapshot())
	require.Nil(t, NewGrants(NewCheckerWithReview("test", time.Minute, func(context.Context, string, string, string, string) (bool, error) {
		return true, nil
	})).Snapshot())
}

// Cancelling the preflight stops it: queued reviews never start and active
// ones return, so a cancelled cluster selection does not keep reviewing.
func TestGrantsPrimeCancelsQueuedAndActiveReviews(t *testing.T) {
	started := make(chan struct{}, 32)
	release := make(chan struct{})
	grants := NewGrants(NewCheckerWithReview("unreachable", time.Minute, func(ctx context.Context, _, _, _, _ string) (bool, error) {
		started <- struct{}{}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-release:
			return false, nil
		}
	}))
	requests := make([]Request, 32)
	for i := range requests {
		requests[i] = Request{Resource: string(rune('a' + i)), Verb: "list"}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- grants.Prime(ctx, requests) }()
	<-started
	cancel()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(time.Second):
		t.Error("permission preflight kept running after its selection was cancelled")
		close(release)
		<-done
	}
}
