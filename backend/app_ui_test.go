package backend

import (
	"context"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

func newUIApp(t *testing.T) *App {
	t.Helper()
	return newTestAppWithDefaults(t)
}

var menuUpdatesEnabled = runtime.GOOS != "linux"

func TestToggleLogsPanelRequiresContext(t *testing.T) {
	app := newUIApp(t)

	err := app.ToggleLogsPanel()
	require.Error(t, err)
	require.False(t, app.IsLogsPanelVisible())
}

func TestToggleDiagnosticsPanelRequiresContext(t *testing.T) {
	app := newUIApp(t)

	err := app.ToggleDiagnosticsPanel()
	require.Error(t, err)
	require.False(t, app.IsDiagnosticsPanelVisible())
}

func TestToggleLogsPanelTogglesAndEmits(t *testing.T) {
	app := newUIApp(t)
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	app.Ctx = context.Background()

	err := app.ToggleLogsPanel()
	require.NoError(t, err)
	require.True(t, app.IsLogsPanelVisible())
	if menuUpdatesEnabled {
		require.Equal(t, []string{"toggle-app-logs", "update-menu"}, events)
	} else {
		require.Equal(t, []string{"toggle-app-logs"}, events)
	}
}

func TestToggleSidebarRequiresContext(t *testing.T) {
	app := newUIApp(t)

	err := app.ToggleSidebar()
	require.Error(t, err)
	require.True(t, app.IsSidebarVisible())
}

func TestToggleSidebarTogglesAndEmits(t *testing.T) {
	app := newUIApp(t)
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	app.Ctx = context.Background()

	err := app.ToggleSidebar()
	require.NoError(t, err)
	require.False(t, app.IsSidebarVisible())
	if menuUpdatesEnabled {
		require.Equal(t, []string{"toggle-sidebar", "update-menu"}, events)
	} else {
		require.Equal(t, []string{"toggle-sidebar"}, events)
	}
}

func TestToggleObjectDiffRequiresContext(t *testing.T) {
	app := newUIApp(t)

	err := app.ToggleObjectDiff()
	require.Error(t, err)
}

func TestToggleObjectDiffEmits(t *testing.T) {
	app := newUIApp(t)
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	app.Ctx = context.Background()

	err := app.ToggleObjectDiff()
	require.NoError(t, err)
	require.Equal(t, []string{"toggle-object-diff"}, events)
}

func TestUpdateMenuNoContext(t *testing.T) {
	app := newUIApp(t)
	emitted := false
	app.eventEmitter = func(context.Context, string, ...interface{}) {
		emitted = true
	}

	app.UpdateMenu()
	require.False(t, emitted)
}

func TestUpdateMenuSkipsOnLinux(t *testing.T) {
	if menuUpdatesEnabled {
		t.Skip("Linux-specific behavior")
	}

	app := newUIApp(t)
	app.Ctx = context.Background()
	emitted := false
	app.eventEmitter = func(context.Context, string, ...interface{}) {
		emitted = true
	}

	app.UpdateMenu()
	require.False(t, emitted)
}

func TestSetSidebarVisibleOnlyWhenChanged(t *testing.T) {
	app := newUIApp(t)
	app.Ctx = context.Background()
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}

	app.SetSidebarVisible(true)
	require.Empty(t, events)

	app.SetSidebarVisible(false)
	if menuUpdatesEnabled {
		require.Equal(t, []string{"update-menu"}, events)
	} else {
		require.Empty(t, events)
	}
	require.False(t, app.IsSidebarVisible())

	events = events[:0]
	app.SetSidebarVisible(false)
	require.Empty(t, events)
}

func TestSetLogsPanelVisibleOnlyWhenChanged(t *testing.T) {
	app := newUIApp(t)
	app.Ctx = context.Background()
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}

	app.SetLogsPanelVisible(false)
	require.Empty(t, events)

	app.SetLogsPanelVisible(true)
	if menuUpdatesEnabled {
		require.Equal(t, []string{"update-menu"}, events)
	} else {
		require.Empty(t, events)
	}
	require.True(t, app.IsLogsPanelVisible())

	events = events[:0]
	app.SetLogsPanelVisible(true)
	require.Empty(t, events)
}

func TestToggleDiagnosticsPanelTogglesAndEmits(t *testing.T) {
	app := newUIApp(t)
	events := []string{}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	app.Ctx = context.Background()

	err := app.ToggleDiagnosticsPanel()
	require.NoError(t, err)
	require.True(t, app.IsDiagnosticsPanelVisible())
	if menuUpdatesEnabled {
		require.Equal(t, []string{"toggle-diagnostics", "update-menu"}, events)
	} else {
		require.Equal(t, []string{"toggle-diagnostics"}, events)
	}
}

func TestCurrentSelectionKey(t *testing.T) {
	app := newUIApp(t)
	app.selectedKubeconfig = "config1"
	require.Equal(t, "config1", app.currentSelectionKey())

	app.selectedContext = "ctx"
	require.Equal(t, "config1:ctx", app.currentSelectionKey())

	app.selectedKubeconfig = ""
	require.Equal(t, "", app.currentSelectionKey())
}

// Legacy permission cache behavior retained for compatibility.
func TestPermissionCacheRoundTrip(t *testing.T) {
	app := newUIApp(t)
	cache := map[string]bool{"get": true}

	require.Nil(t, app.getPermissionCache(""))

	app.setPermissionCache("key", cache)
	cloned := app.getPermissionCache("key")
	require.NotNil(t, cloned)
	require.True(t, cloned["get"])

	cache["get"] = false
	require.True(t, app.getPermissionCache("key")["get"])
}

func TestEmitEventNoContext(t *testing.T) {
	app := newUIApp(t)
	called := false
	app.eventEmitter = func(context.Context, string, ...interface{}) {
		called = true
	}

	app.emitEvent("something")
	require.False(t, called)

	app.Ctx = context.Background()
	app.emitEvent("something")
	require.True(t, called)
}
