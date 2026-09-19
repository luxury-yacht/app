package common

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLookupDefaultTimeoutPreservesCallerDeadlineAndCancellationOwnership(t *testing.T) {
	parent, cancelParent := context.WithTimeout(context.Background(), time.Hour)
	defer cancelParent()
	lookup, cancelLookup := WithDefaultTimeout(parent, time.Minute)
	parentDeadline, _ := parent.Deadline()
	lookupDeadline, ok := lookup.Deadline()
	require.True(t, ok)
	require.Equal(t, parentDeadline, lookupDeadline)
	cancelLookup()
	require.NoError(t, parent.Err())
	cancelParent()
	require.ErrorIs(t, lookup.Err(), context.Canceled)
}

func TestLookupDefaultTimeoutBoundsUnboundedContexts(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	defer cancelParent()
	for _, ctx := range []context.Context{nil, context.Background(), parent} {
		lookup, cancelLookup := WithDefaultTimeout(ctx, 0)
		require.ErrorIs(t, lookup.Err(), context.DeadlineExceeded)
		cancelLookup()
	}
	require.NoError(t, parent.Err())
	lookup, cancelLookup := WithDefaultTimeout(parent, time.Hour)
	defer cancelLookup()
	cancelParent()
	require.ErrorIs(t, lookup.Err(), context.Canceled)
}
