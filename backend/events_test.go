package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestCustomWailsEventsEnforceTheirPayloadTypes(t *testing.T) {
	wailsApp := application.New(application.Options{})

	require.False(t, wailsApp.Event.Emit("object-shell:output", ShellOutputEvent{
		SessionID: "session-a",
		ClusterID: "cluster-a",
		Stream:    "stdout",
		Data:      "ready\n",
	}))
	require.True(t, wailsApp.Event.Emit("object-shell:output", "wrong payload"))

	require.False(t, wailsApp.Event.Emit("open-cluster"))
	require.True(t, wailsApp.Event.Emit("open-cluster", "wrong payload"))

	require.False(t, wailsApp.Event.Emit("settings:appearance-mode-changed", AppearanceModeChangedEvent{
		Mode: "dark",
	}))
	require.True(t, wailsApp.Event.Emit("settings:appearance-mode-changed", "wrong payload"))
}
