package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWorkspaceWindowLifecycleTreatsEveryWindowAsAPeer(t *testing.T) {
	lifecycle := newWorkspaceWindowLifecycle()

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

func TestWorkspaceWindowLifecycleRestoresACancelledLastClose(t *testing.T) {
	lifecycle := newWorkspaceWindowLifecycle()
	windowName := lifecycle.Add()

	remaining, ok := lifecycle.BeginClose(windowName)
	require.True(t, ok)
	require.Zero(t, remaining)

	lifecycle.CancelClose(windowName)
	require.Equal(t, 1, lifecycle.Count())
	require.Equal(t, windowName, lifecycle.MostRecent())
}

func TestWorkspaceWindowLifecycleTracksTheMostRecentlyFocusedPeer(t *testing.T) {
	lifecycle := newWorkspaceWindowLifecycle()
	first := lifecycle.Add()
	second := lifecycle.Add()

	lifecycle.Focus(first)
	require.Equal(t, first, lifecycle.MostRecent())

	lifecycle.Focus(second)
	require.Equal(t, second, lifecycle.MostRecent())
}
