package informer

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/stretchr/testify/require"
)

func TestPermissionPreflightCancelsQueuedAndActiveReviews(t *testing.T) {
	started := make(chan struct{}, 32)
	release := make(chan struct{})
	checker := permissions.NewCheckerWithReview("unreachable", time.Minute, func(ctx context.Context, _, _, _, _ string) (bool, error) {
		started <- struct{}{}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-release:
			return false, nil
		}
	})
	factory := &Factory{runtimePermissions: checker}
	requests := make([]PermissionRequest, 32)
	for i := range requests {
		requests[i] = PermissionRequest{Resource: string(rune('a' + i)), Verb: "list"}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- factory.PrimePermissions(ctx, requests) }()
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
