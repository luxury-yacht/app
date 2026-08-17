package backend

import (
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func menuItems(menu *application.Menu) []*application.MenuItem {
	items := []*application.MenuItem{}
	for index := 0; ; index++ {
		item := menu.ItemAt(index)
		if item == nil {
			return items
		}
		items = append(items, item)
	}
}

func findSubmenu(t *testing.T, menu *application.Menu, label string) *application.Menu {
	t.Helper()
	for _, item := range menuItems(menu) {
		if item.Label() == label && item.GetSubmenu() != nil {
			return item.GetSubmenu()
		}
	}
	t.Fatalf("expected submenu %q", label)
	return nil
}

func menuLabels(menu *application.Menu) []string {
	items := menuItems(menu)
	labels := make([]string, 0, len(items))
	for _, item := range items {
		labels = append(labels, item.Label())
	}
	return labels
}

func TestCreateMenuBuildsEntries(t *testing.T) {
	menu := CreateMenu(&DesktopShell{sidebarVisible: true})
	require.NotNil(t, menu)
	require.NotEmpty(t, menuItems(menu))
}

func TestCreateMenuTopLevelLabels(t *testing.T) {
	menu := CreateMenu(&DesktopShell{sidebarVisible: true})

	var expected []string
	switch runtime.GOOS {
	case "darwin":
		expected = []string{"Luxury Yacht", "File", "Edit", "View", "Window"}
	default:
		expected = []string{"File", "Edit", "View", "Window", "Help"}
	}
	if appDebugMenuEnabled {
		if runtime.GOOS == "darwin" {
			expected = []string{"Luxury Yacht", "File", "Edit", "View", "Window", "Debug"}
		} else {
			expected = []string{"File", "Edit", "View", "Window", "Debug", "Help"}
		}
	}
	require.Equal(t, expected, menuLabels(menu))
}

func TestAddMenuTextPreservesAccelerator(t *testing.T) {
	menu := application.NewMenu()
	addMenuText(menu, "Open Cluster", "CmdOrCtrl+o", func() {})

	want := "Ctrl+O"
	if runtime.GOOS == "darwin" {
		want = "Cmd+O"
	}
	require.Equal(t, want, menu.ItemAt(0).GetAccelerator())
}

func TestCreateDebugMenuBuildsDebugOverlayEntries(t *testing.T) {
	menu := application.NewMenu()
	createDebugMenu(menu, &DesktopShell{sidebarVisible: true})

	require.Equal(t, []string{
		"Open Inspector",
		"",
		"Keyboard Focus Overlay",
		"Panel Debug Overlay",
		"Map Debug Overlay",
		"Icon Debug Overlay",
		"Error Boundary Tests",
	}, menuLabels(findSubmenu(t, menu, "Debug")))
}

func TestEditMenuOffersStandardClipboardCommands(t *testing.T) {
	menu := application.NewMenu()
	createEditMenu(menu, &DesktopShell{sidebarVisible: true})
	require.Equal(t, []string{"Cut", "Copy", "Paste", "Select All"}, menuLabels(findSubmenu(t, menu, "Edit")))
}

func TestMenuEventCallbacksRequireRuntimeReadiness(t *testing.T) {
	ready := false
	events := []string{}
	app := NewDesktopShell(nil, func() bool { return ready }, func(name string, _ ...interface{}) {
		events = append(events, name)
	}, NewLogger(10))
	callback := emitMenuEventWhenReady(app, "open-cluster")

	callback()
	require.Empty(t, events)

	ready = true
	callback()
	require.Equal(t, []string{"open-cluster"}, events)
}

func TestViewMenuKeepsApplicationLogsAndDiagnosticsEntries(t *testing.T) {
	menu := application.NewMenu()
	createViewMenu(menu, &DesktopShell{sidebarVisible: true})

	labels := menuLabels(findSubmenu(t, menu, "View"))
	require.Contains(t, labels, "Show Application Logs")
	require.Contains(t, labels, "Show Diagnostics Panel")
}

func TestFileMenuOffersOpenCluster(t *testing.T) {
	menu := application.NewMenu()
	createApplicationMenu(menu, &DesktopShell{sidebarVisible: true})
	labels := menuLabels(findSubmenu(t, menu, "File"))
	require.Contains(t, labels, "New Window")
	require.Contains(t, labels, "Open Cluster")
}

func TestViewMenuOffersCommandPalette(t *testing.T) {
	menu := application.NewMenu()
	createViewMenu(menu, &DesktopShell{sidebarVisible: true})
	require.Contains(t, menuLabels(findSubmenu(t, menu, "View")), "Command Palette")
}

func TestMacApplicationMenuOffersCheckForUpdates(t *testing.T) {
	menu := application.NewMenu()
	addMacApplicationMenu(menu, &DesktopShell{sidebarVisible: true})

	require.Contains(t, menuLabels(findSubmenu(t, menu, "Luxury Yacht")), "Check for Updates…")
}

func TestDesktopHelpMenuOffersCheckForUpdates(t *testing.T) {
	menu := application.NewMenu()
	addDesktopHelpMenu(menu, &DesktopShell{sidebarVisible: true})

	require.Contains(t, menuLabels(findSubmenu(t, menu, "Help")), "Check for Updates…")
}

func TestDebugMenuEventsUseReadinessGuard(t *testing.T) {
	events := []string{}
	app := NewDesktopShell(nil, func() bool { return true }, func(name string, _ ...interface{}) {
		events = append(events, name)
	}, NewLogger(10))

	for _, event := range []string{
		"debug:open-inspector",
		"debug:toggle-focus-overlay",
		"debug:toggle-panel-overlay",
		"debug:toggle-map-overlay",
		"debug:toggle-icon-overlay",
		"debug:toggle-error-overlay",
	} {
		emitMenuEventWhenReady(app, event)()
	}

	require.Equal(t, []string{
		"debug:open-inspector",
		"debug:toggle-focus-overlay",
		"debug:toggle-panel-overlay",
		"debug:toggle-map-overlay",
		"debug:toggle-icon-overlay",
		"debug:toggle-error-overlay",
	}, events)
}

func TestFileMenuOffersNewWindowAccelerator(t *testing.T) {
	fileMenu := findSubmenu(t, CreateMenu(&DesktopShell{sidebarVisible: true}), "File")
	for _, item := range menuItems(fileMenu) {
		if item.Label() != "New Window" {
			continue
		}
		want := "Ctrl+N"
		if runtime.GOOS == "darwin" {
			want = "Cmd+N"
		}
		require.Equal(t, want, item.GetAccelerator())
		return
	}
	t.Fatal("New Window menu item not found")
}

func TestDesktopShellReceivesWorkspaceWindowCreatorAtConstruction(t *testing.T) {
	called := false
	app := NewDesktopShell(nil, nil, nil, nil, DesktopShellBindings{
		CreateWorkspaceWindow: func() { called = true },
	})

	require.NotNil(t, app.createWorkspaceWindow)
	app.createWorkspaceWindowFromMenu()
	require.True(t, called)
}
