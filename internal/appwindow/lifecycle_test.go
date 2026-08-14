package appwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLifecycleTreatsEveryWindowAsAPeer(t *testing.T) {
	lifecycle := newLifecycle()

	first := lifecycle.Add()
	second := lifecycle.Add()
	third := lifecycle.Add()

	require.Equal(t, "workspace-1", first)
	require.Equal(t, "workspace-2", second)
	require.Equal(t, "workspace-3", third)
	require.Equal(t, 3, lifecycle.Count())

	remaining, ok := lifecycle.BeginClose(second)
	require.True(t, ok)
	require.Equal(t, 2, remaining)
	require.Equal(t, 2, lifecycle.Count())

	remaining, ok = lifecycle.BeginClose(first)
	require.True(t, ok)
	require.Equal(t, 1, remaining)
	require.Equal(t, third, lifecycle.MostRecent())

	remaining, ok = lifecycle.BeginClose(third)
	require.True(t, ok)
	require.Zero(t, remaining)
	require.Zero(t, lifecycle.Count())
}

func TestLifecycleRestoresACancelledLastClose(t *testing.T) {
	lifecycle := newLifecycle()
	windowName := lifecycle.Add()

	remaining, ok := lifecycle.BeginClose(windowName)
	require.True(t, ok)
	require.Zero(t, remaining)

	lifecycle.CancelClose(windowName)
	require.Equal(t, 1, lifecycle.Count())
	require.Equal(t, windowName, lifecycle.MostRecent())
}

func TestLifecycleTracksTheMostRecentlyFocusedPeer(t *testing.T) {
	lifecycle := newLifecycle()
	first := lifecycle.Add()
	second := lifecycle.Add()

	lifecycle.Focus(first)
	require.Equal(t, first, lifecycle.MostRecent())

	lifecycle.Focus(second)
	require.Equal(t, second, lifecycle.MostRecent())
}

func TestLifecycleIgnoresUnknownAndDuplicateTransitions(t *testing.T) {
	lifecycle := newLifecycle()
	windowName := lifecycle.Add()

	lifecycle.Focus("workspace-unknown")
	lifecycle.CancelClose(windowName)
	remaining, tracked := lifecycle.BeginClose("workspace-unknown")

	require.False(t, tracked)
	require.Equal(t, 1, remaining)
	require.Equal(t, windowName, lifecycle.MostRecent())

	_, tracked = lifecycle.BeginClose(windowName)
	require.True(t, tracked)
	require.Empty(t, lifecycle.MostRecent())
}
