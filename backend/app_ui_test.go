package backend

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func newUIApp(t *testing.T) *App {
	t.Helper()
	return newTestAppWithDefaults(t)
}

func viewMenuItem(t *testing.T, app *App, label string) *application.MenuItem {
	t.Helper()
	view := findSubmenu(t, app.menu, "View")
	for index := 0; ; index++ {
		item := view.ItemAt(index)
		if item == nil {
			t.Fatalf("expected View menu item %q", label)
		}
		if item.Label() == label {
			return item
		}
	}
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
	CreateMenu(app)
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	setTestAppRuntimeReady(t, app, context.Background())

	err := app.ToggleAppLogsPanel()
	require.NoError(t, err)
	require.True(t, app.IsAppLogsPanelVisible())
	require.Equal(t, []string{"toggle-app-logs-panel"}, events)
	require.NotNil(t, viewMenuItem(t, app, "Hide Application Logs"))
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
	CreateMenu(app)
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	setTestAppRuntimeReady(t, app, context.Background())

	err := app.ToggleSidebar()
	require.NoError(t, err)
	require.False(t, app.IsSidebarVisible())
	require.Equal(t, []string{"toggle-sidebar"}, events)
	require.NotNil(t, viewMenuItem(t, app, "Show Sidebar"))
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
	setTestAppRuntimeReady(t, app, context.Background())

	err := app.ToggleObjectDiff()
	require.NoError(t, err)
	require.Equal(t, []string{"toggle-object-diff"}, events)
}

func TestUpdateMenuNoContext(t *testing.T) {
	app := newUIApp(t)
	CreateMenu(app)
	before := viewMenuItem(t, app, "Hide Sidebar")
	app.sidebarVisible = false

	app.UpdateMenu()
	require.Same(t, before, viewMenuItem(t, app, "Hide Sidebar"))
}

func TestUpdateMenuRefreshesPersistentNativeMenu(t *testing.T) {
	app := newUIApp(t)
	CreateMenu(app)
	before := viewMenuItem(t, app, "Hide Sidebar")
	setTestAppRuntimeReady(t, app, context.Background())
	app.sidebarVisible = false

	app.UpdateMenu()
	after := viewMenuItem(t, app, "Show Sidebar")
	require.NotSame(t, before, after)
}

func TestSetSidebarVisibleOnlyWhenChanged(t *testing.T) {
	app := newUIApp(t)
	CreateMenu(app)
	setTestAppRuntimeReady(t, app, context.Background())
	before := viewMenuItem(t, app, "Hide Sidebar")

	app.SetSidebarVisible(true)
	require.Same(t, before, viewMenuItem(t, app, "Hide Sidebar"))

	app.SetSidebarVisible(false)
	after := viewMenuItem(t, app, "Show Sidebar")
	require.NotSame(t, before, after)
	require.False(t, app.IsSidebarVisible())

	app.SetSidebarVisible(false)
	require.Same(t, after, viewMenuItem(t, app, "Show Sidebar"))
}

func TestSetAppLogsPanelVisibleOnlyWhenChanged(t *testing.T) {
	app := newUIApp(t)
	CreateMenu(app)
	setTestAppRuntimeReady(t, app, context.Background())
	before := viewMenuItem(t, app, "Show Application Logs")

	app.SetAppLogsPanelVisible(false)
	require.Same(t, before, viewMenuItem(t, app, "Show Application Logs"))

	app.SetAppLogsPanelVisible(true)
	after := viewMenuItem(t, app, "Hide Application Logs")
	require.NotSame(t, before, after)
	require.True(t, app.IsAppLogsPanelVisible())

	app.SetAppLogsPanelVisible(true)
	require.Same(t, after, viewMenuItem(t, app, "Hide Application Logs"))
}

func TestToggleDiagnosticsPanelTogglesAndEmits(t *testing.T) {
	app := newUIApp(t)
	events := []string{}
	CreateMenu(app)
	app.eventEmitter = func(_ context.Context, name string, _ ...interface{}) {
		events = append(events, name)
	}
	setTestAppRuntimeReady(t, app, context.Background())

	err := app.ToggleDiagnosticsPanel()
	require.NoError(t, err)
	require.True(t, app.IsDiagnosticsPanelVisible())
	require.Equal(t, []string{"toggle-diagnostics"}, events)
	require.NotNil(t, viewMenuItem(t, app, "Hide Diagnostics Panel"))
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

	setTestAppRuntimeReady(t, app, context.Background())
	app.emitEvent("something")
	require.True(t, called)
}
