package backend

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func newUIApp(t *testing.T) *App {
	t.Helper()
	return newTestAppWithDefaults(t)
}

func TestToggleAppLogsPanelRequiresContext(t *testing.T) {
	app := newUIApp(t)

	err := app.ToggleAppLogsPanel()
	require.Error(t, err)
	require.False(t, app.IsAppLogsPanelVisible())
}

func TestToggleDiagnosticsPanelRequiresContext(t *testing.T) {
	app := newUIApp(t)

	err := app.ToggleDiagnosticsPanel()
	require.Error(t, err)
	require.False(t, app.IsDiagnosticsPanelVisible())
}

func TestToggleAppLogsPanelTogglesAndEmits(t *testing.T) {
	app := newUIApp(t)
	events := []string{}
	menuUpdates := 0
	app.desktop = &fakeDesktop{refreshMenu: func() error { menuUpdates++; return nil }}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	app.setApplicationContext(context.Background())
	app.markRuntimeReady()

	err := app.ToggleAppLogsPanel()
	require.NoError(t, err)
	require.True(t, app.IsAppLogsPanelVisible())
	require.Equal(t, []string{"toggle-app-logs-panel"}, events)
	require.Equal(t, 1, menuUpdates)
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
	menuUpdates := 0
	app.desktop = &fakeDesktop{refreshMenu: func() error { menuUpdates++; return nil }}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	app.setApplicationContext(context.Background())
	app.markRuntimeReady()

	err := app.ToggleSidebar()
	require.NoError(t, err)
	require.False(t, app.IsSidebarVisible())
	require.Equal(t, []string{"toggle-sidebar"}, events)
	require.Equal(t, 1, menuUpdates)
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
	app.setApplicationContext(context.Background())
	app.markRuntimeReady()

	err := app.ToggleObjectDiff()
	require.NoError(t, err)
	require.Equal(t, []string{"toggle-object-diff"}, events)
}

func TestUpdateMenuNoContext(t *testing.T) {
	app := newUIApp(t)
	updated := false
	app.desktop = &fakeDesktop{refreshMenu: func() error { updated = true; return nil }}

	app.UpdateMenu()
	require.False(t, updated)
}

func TestUpdateMenuRefreshesPersistentNativeMenu(t *testing.T) {
	app := newUIApp(t)
	app.setApplicationContext(context.Background())
	app.markRuntimeReady()
	updated := false
	app.desktop = &fakeDesktop{refreshMenu: func() error { updated = true; return nil }}

	app.UpdateMenu()
	require.True(t, updated)
}

func TestSetSidebarVisibleOnlyWhenChanged(t *testing.T) {
	app := newUIApp(t)
	app.setApplicationContext(context.Background())
	app.markRuntimeReady()
	menuUpdates := 0
	app.desktop = &fakeDesktop{refreshMenu: func() error { menuUpdates++; return nil }}

	app.SetSidebarVisible(true)
	require.Zero(t, menuUpdates)

	app.SetSidebarVisible(false)
	require.Equal(t, 1, menuUpdates)
	require.False(t, app.IsSidebarVisible())

	app.SetSidebarVisible(false)
	require.Equal(t, 1, menuUpdates)
}

func TestSetAppLogsPanelVisibleOnlyWhenChanged(t *testing.T) {
	app := newUIApp(t)
	app.setApplicationContext(context.Background())
	app.markRuntimeReady()
	menuUpdates := 0
	app.desktop = &fakeDesktop{refreshMenu: func() error { menuUpdates++; return nil }}

	app.SetAppLogsPanelVisible(false)
	require.Zero(t, menuUpdates)

	app.SetAppLogsPanelVisible(true)
	require.Equal(t, 1, menuUpdates)
	require.True(t, app.IsAppLogsPanelVisible())

	app.SetAppLogsPanelVisible(true)
	require.Equal(t, 1, menuUpdates)
}

func TestToggleDiagnosticsPanelTogglesAndEmits(t *testing.T) {
	app := newUIApp(t)
	events := []string{}
	menuUpdates := 0
	app.desktop = &fakeDesktop{refreshMenu: func() error { menuUpdates++; return nil }}
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	app.setApplicationContext(context.Background())
	app.markRuntimeReady()

	err := app.ToggleDiagnosticsPanel()
	require.NoError(t, err)
	require.True(t, app.IsDiagnosticsPanelVisible())
	require.Equal(t, []string{"toggle-diagnostics"}, events)
	require.Equal(t, 1, menuUpdates)
}

// Legacy permission cache behavior retained for compatibility.
func TestEmitEventNoContext(t *testing.T) {
	app := newUIApp(t)
	called := false
	app.eventEmitter = func(context.Context, string, ...interface{}) {
		called = true
	}

	app.emitEvent("something")
	require.False(t, called)

	app.setApplicationContext(context.Background())
	app.markRuntimeReady()
	app.emitEvent("something")
	require.True(t, called)
}
