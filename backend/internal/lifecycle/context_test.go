package lifecycle

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestContextReflectsLifecycleCancellation(t *testing.T) {
	done := make(chan struct{})
	ctx := Context(done)
	deadline, hasDeadline := ctx.Deadline()
	require.False(t, hasDeadline)
	require.True(t, deadline.IsZero())
	require.Equal(t, (<-chan struct{})(done), ctx.Done())
	require.Nil(t, ctx.Value("runtime-only-value"))
	require.NoError(t, ctx.Err())

	close(done)
	require.ErrorIs(t, ctx.Err(), context.Canceled)
	require.ErrorIs(t, context.Cause(ctx), context.Canceled)
}

func TestContextWithNilSignalRemainsActive(t *testing.T) {
	ctx := Context(nil)
	require.NoError(t, ctx.Err())
	require.Nil(t, ctx.Done())
}
