package backend

import (
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func workspaceNativeDescriptor(name string) (panelwindow.NativeDescriptor, error) {
	if name != "workspace-1" {
		return panelwindow.NativeDescriptor{}, fmt.Errorf("native window %q is not registered", name)
	}
	return panelwindow.NativeDescriptor{
		SchemaVersion: panelwindow.NativeDescriptorSchemaVersion,
		Role:          panelwindow.NativeRoleWorkspace,
		Workspace:     &panelwindow.WorkspaceDescriptor{WindowName: name},
	}, nil
}

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
	}, NewLogger(10), DesktopShellBindings{NativeWindowDescriptor: workspaceNativeDescriptor})
	require.Error(
		t,
		app.ExecuteApplicationMenuCommand("workspace-1", ApplicationMenuCommandOpenCluster),
	)
	require.Empty(t, events)

	ready = true
	require.NoError(
		t,
		app.ExecuteApplicationMenuCommand("workspace-1", ApplicationMenuCommandOpenCluster),
	)
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

func TestZoomInAcceleratorUsesThePhysicalEqualsKeyOnMacOS(t *testing.T) {
	require.Equal(t, "CmdOrCtrl+=", zoomInAccelerator("darwin"))
	require.Equal(t, "", zoomInAccelerator("windows"))
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
	}, NewLogger(10), DesktopShellBindings{NativeWindowDescriptor: workspaceNativeDescriptor})

	for _, command := range []ApplicationMenuCommand{
		ApplicationMenuCommandOpenInspector,
		ApplicationMenuCommandToggleFocusDebug,
		ApplicationMenuCommandTogglePanelDebug,
		ApplicationMenuCommandToggleMapDebug,
		ApplicationMenuCommandToggleIconDebug,
		ApplicationMenuCommandToggleErrorDebug,
	} {
		require.NoError(t, app.ExecuteApplicationMenuCommand("workspace-1", command))
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

func TestApplicationMenuCommandsShareOneTypedRoleAwareDispatcher(t *testing.T) {
	events := []string{}
	created := false
	shell := NewDesktopShell(
		nil,
		func() bool { return true },
		func(name string, _ ...interface{}) { events = append(events, name) },
		NewLogger(10),
		DesktopShellBindings{
			CreateWorkspaceWindow:  func() { created = true },
			NativeWindowDescriptor: workspaceNativeDescriptor,
		},
	)

	require.NoError(t, shell.ExecuteApplicationMenuCommand("", ApplicationMenuCommandNewWindow))
	require.True(t, created)
	require.NoError(t, shell.ExecuteApplicationMenuCommand("workspace-1", ApplicationMenuCommandOpenCluster))
	require.Equal(t, []string{"open-cluster"}, events)
	require.ErrorContains(
		t,
		shell.ExecuteApplicationMenuCommand("panel-1", ApplicationMenuCommandOpenCluster),
		`native window "panel-1" is not registered`,
	)
	require.ErrorContains(
		t,
		shell.ExecuteApplicationMenuCommand("workspace-1", ApplicationMenuCommand("unknown")),
		`unknown application menu command "unknown"`,
	)
}

func TestUntargetedNativeApplicationCommandsDoNotRequireACurrentWindow(t *testing.T) {
	events := []string{}
	created := false
	quit := false
	checked := make(chan struct{}, 1)
	shell := NewDesktopShell(
		nil,
		func() bool { return true },
		func(name string, _ ...interface{}) { events = append(events, name) },
		NewLogger(10),
		DesktopShellBindings{
			CreateWorkspaceWindow:  func() { created = true },
			NativeWindowDescriptor: workspaceNativeDescriptor,
			UpdateCheck:            func() error { checked <- struct{}{}; return nil },
		},
	)
	shell.quitApplication = func() { quit = true }

	require.NoError(t, shell.ExecuteApplicationMenuCommand("", ApplicationMenuCommandNewWindow))
	require.NoError(t, shell.ExecuteApplicationMenuCommand("", ApplicationMenuCommandQuit))
	require.NoError(t, shell.ExecuteApplicationMenuCommand("", ApplicationMenuCommandSettings))
	require.NoError(t, shell.ExecuteApplicationMenuCommand("", ApplicationMenuCommandAbout))
	require.NoError(t, shell.ExecuteApplicationMenuCommand("", ApplicationMenuCommandCheckForUpdates))

	require.True(t, created)
	require.True(t, quit)
	require.Equal(t, []string{"open-settings", "open-about", "open-about"}, events)
	select {
	case <-checked:
	case <-time.After(time.Second):
		t.Fatal("expected update check")
	}
}

func TestApplicationMenuCommandCatalogIsUniqueAndHandled(t *testing.T) {
	commands := []ApplicationMenuCommand{
		ApplicationMenuCommandNewWindow,
		ApplicationMenuCommandOpenCluster,
		ApplicationMenuCommandClose,
		ApplicationMenuCommandSettings,
		ApplicationMenuCommandQuit,
		ApplicationMenuCommandHide,
		ApplicationMenuCommandCut,
		ApplicationMenuCommandCopy,
		ApplicationMenuCommandPaste,
		ApplicationMenuCommandSelectAll,
		ApplicationMenuCommandCommandPalette,
		ApplicationMenuCommandZoomIn,
		ApplicationMenuCommandZoomOut,
		ApplicationMenuCommandZoomReset,
		ApplicationMenuCommandToggleSidebar,
		ApplicationMenuCommandToggleObjectDiff,
		ApplicationMenuCommandToggleAppLogs,
		ApplicationMenuCommandToggleDiagnostics,
		ApplicationMenuCommandOpenInspector,
		ApplicationMenuCommandToggleFocusDebug,
		ApplicationMenuCommandTogglePanelDebug,
		ApplicationMenuCommandToggleMapDebug,
		ApplicationMenuCommandToggleIconDebug,
		ApplicationMenuCommandToggleErrorDebug,
		ApplicationMenuCommandMinimise,
		ApplicationMenuCommandMaximise,
		ApplicationMenuCommandRestore,
		ApplicationMenuCommandToggleMaximise,
		ApplicationMenuCommandBringAllToFront,
		ApplicationMenuCommandAbout,
		ApplicationMenuCommandCheckForUpdates,
	}
	seen := make(map[ApplicationMenuCommand]struct{}, len(commands))
	shell := NewDesktopShell(
		nil,
		func() bool { return true },
		func(string, ...interface{}) {},
		NewLogger(10),
		DesktopShellBindings{NativeWindowDescriptor: workspaceNativeDescriptor},
	)

	for _, command := range commands {
		_, duplicate := seen[command]
		require.Falsef(t, duplicate, "duplicate application menu command %q", command)
		seen[command] = struct{}{}

		err := shell.ExecuteApplicationMenuCommand("workspace-1", command)
		require.NotContains(t, fmt.Sprint(err), "unknown application menu command")
	}
}

func TestApplicationMenuCommandsTargetTheAuthenticatedWindow(t *testing.T) {
	wailsApp := application.New(application.Options{})
	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{Name: "workspace-1"})
	shell := NewDesktopShell(
		wailsApp,
		func() bool { return true },
		nil,
		NewLogger(10),
		DesktopShellBindings{
			NativeWindowDescriptor: workspaceNativeDescriptor,
		},
	)

	require.NoError(
		t,
		shell.ExecuteApplicationMenuCommand("workspace-1", ApplicationMenuCommandOpenCluster),
	)
	for _, command := range []ApplicationMenuCommand{
		ApplicationMenuCommandMinimise,
		ApplicationMenuCommandMaximise,
		ApplicationMenuCommandRestore,
		ApplicationMenuCommandToggleMaximise,
	} {
		require.NoError(t, shell.ExecuteApplicationMenuCommand("workspace-1", command))
	}
	require.ErrorContains(
		t,
		shell.executeApplicationWindowCommand("workspace-1", ApplicationMenuCommand("unknown")),
		"unknown application window command",
	)

	require.ErrorContains(
		t,
		shell.ExecuteApplicationMenuCommand("workspace-missing", ApplicationMenuCommandOpenCluster),
		`native window "workspace-missing" is not registered`,
	)
}

func TestApplicationMenuWindowCommandsCanTargetALivePanelWindow(t *testing.T) {
	wailsApp := application.New(application.Options{})
	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{Name: "panel-1"})
	shell := NewDesktopShell(
		wailsApp,
		func() bool { return true },
		nil,
		NewLogger(10),
		DesktopShellBindings{
			NativeWindowDescriptor: func(name string) (panelwindow.NativeDescriptor, error) {
				return panelwindow.NativeDescriptor{
					SchemaVersion: panelwindow.NativeDescriptorSchemaVersion,
					Role:          panelwindow.NativeRolePanel,
					Panel: &panelwindow.WindowDescriptor{
						WindowName:      name,
						OwnerWindowName: "workspace-1",
						State:           panelwindow.WindowStateLive,
					},
				}, nil
			},
		},
	)

	for _, command := range []ApplicationMenuCommand{
		ApplicationMenuCommandMinimise,
		ApplicationMenuCommandMaximise,
		ApplicationMenuCommandRestore,
		ApplicationMenuCommandToggleMaximise,
	} {
		require.NoError(t, shell.ExecuteApplicationMenuCommand("panel-1", command))
	}
}

func TestApplicationMenuUpdateCheckTargetsTheCallerBeforeStartingDiscovery(t *testing.T) {
	events := []string{}
	checked := make(chan struct{}, 1)
	shell := NewDesktopShell(
		nil,
		func() bool { return true },
		func(name string, _ ...interface{}) { events = append(events, name) },
		NewLogger(10),
		DesktopShellBindings{
			NativeWindowDescriptor: workspaceNativeDescriptor,
			UpdateCheck: func() error {
				checked <- struct{}{}
				return nil
			},
		},
	)

	require.NoError(
		t,
		shell.ExecuteApplicationMenuCommand("workspace-1", ApplicationMenuCommandCheckForUpdates),
	)
	require.Equal(t, []string{"open-about"}, events)
	select {
	case <-checked:
	case <-time.After(time.Second):
		t.Fatal("update check did not start")
	}
}
