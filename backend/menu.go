package backend

import (
	"context"
	"os"
	"os/exec"
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// CreateMenu creates the application menu with OS-specific adjustments
func CreateMenu(app *App) *menu.Menu {
	appMenu := menu.NewMenu()

	// Application menu (macOS only) and File menu (all platforms)
	createApplicationMenu(appMenu, app)

	// Edit menu (for standard editing shortcuts)
	createEditMenu(appMenu, app)

	// View menu
	createViewMenu(appMenu, app)

	// Window menu
	createWindowMenu(appMenu, app)

	// Debug menu is only compiled into Wails dev builds.
	if appDebugMenuEnabled {
		createDebugMenu(appMenu, app)
	}

	// Help menu (rightmost, Windows/Linux only)
	createHelpMenu(appMenu, app)

	return appMenu
}

// spawnNewWindow starts a new instance of the application as a separate process
func spawnNewWindow() {
	execPath, err := os.Executable()
	if err != nil {
		println("Failed to get executable path:", err.Error())
		return
	}

	cmd := exec.Command(execPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		println("Failed to spawn new window:", err.Error())
	}
}

// createApplicationMenu creates the macOS app menu and the File menu (all platforms)
func createApplicationMenu(appMenu *menu.Menu, app *App) {
	if runtime.GOOS == "darwin" {
		addMacApplicationMenu(appMenu, app)
	}
	addFileMenu(appMenu, app)
}

func addMacApplicationMenu(appMenu *menu.Menu, app *App) {
	appSubmenu := appMenu.AddSubmenu("Luxury Yacht")
	appSubmenu.AddText("About Luxury Yacht", nil, asyncMenuCallback(app.ShowAbout))
	appSubmenu.AddSeparator()
	appSubmenu.AddText("Settings...", keys.CmdOrCtrl(","), asyncMenuCallback(app.ShowSettings))
	appSubmenu.AddText("Hide Luxury Yacht", keys.CmdOrCtrl("h"), hideApplicationCallback(app))
	appSubmenu.AddText("Quit", keys.CmdOrCtrl("q"), quitApplicationCallback(app))
}

func addFileMenu(appMenu *menu.Menu, app *App) {
	fileMenu := appMenu.AddSubmenu("File")
	fileMenu.AddText("New Window", keys.CmdOrCtrl("n"), asyncMenuCallback(spawnNewWindow))

	// Open Cluster emits an event the frontend uses to open the Open Cluster
	// modal (the "+" in the cluster tab bar does the same). The accelerator is
	// the shortcut, mirroring New Window/Close.
	fileMenu.AddText("Open Cluster", keys.CmdOrCtrl("o"), emitMenuEventWhenReady(app, "open-cluster"))

	// Close emits an event to the frontend, which decides whether to close a
	// cluster tab or quit the application (Chrome/VS Code style Cmd/Ctrl+W).
	fileMenu.AddText("Close Cluster", keys.CmdOrCtrl("w"), emitMenuEventWhenReady(app, "menu:close"))

	if runtime.GOOS != "darwin" {
		addDesktopFileMenuItems(fileMenu, app)
	}
}

func addDesktopFileMenuItems(fileMenu *menu.Menu, app *App) {
	fileMenu.AddSeparator()
	fileMenu.AddText("Settings...", keys.CmdOrCtrl(","), asyncMenuCallback(app.ShowSettings))
	fileMenu.AddSeparator()
	exitLabel := "Quit"
	if runtime.GOOS == "windows" {
		exitLabel = "Exit"
	}
	fileMenu.AddText(exitLabel, keys.CmdOrCtrl("q"), quitApplicationCallback(app))
}

func asyncMenuCallback(action func()) func(*menu.CallbackData) {
	return func(_ *menu.CallbackData) {
		go action()
	}
}

func hideApplicationCallback(app *App) func(*menu.CallbackData) {
	return func(_ *menu.CallbackData) {
		go func() {
			app.runWithRuntimeContext(wailsRuntime.Hide)
		}()
	}
}

func quitApplicationCallback(app *App) func(*menu.CallbackData) {
	return func(_ *menu.CallbackData) {
		app.runWithRuntimeContext(wailsRuntime.Quit)
	}
}

func emitMenuEventWhenReady(app *App, event string) func(*menu.CallbackData) {
	return func(_ *menu.CallbackData) {
		if app.runtimeAvailable() {
			app.emitEvent(event)
		}
	}
}

// createEditMenu creates the Edit menu with standard editing commands
func createEditMenu(appMenu *menu.Menu, app *App) {
	editMenu := appMenu.AddSubmenu("Edit")

	// Cut
	editMenu.AddText("Cut", keys.CmdOrCtrl("x"), func(_ *menu.CallbackData) {
		// This will be handled by the frontend
		if app.runtimeAvailable() {
			app.emitEvent("menu:cut")
		}
	})

	// Copy
	editMenu.AddText("Copy", keys.CmdOrCtrl("c"), func(_ *menu.CallbackData) {
		// This will be handled by the frontend
		if app.runtimeAvailable() {
			app.emitEvent("menu:copy")
		}
	})

	// Paste
	editMenu.AddText("Paste", keys.CmdOrCtrl("v"), func(_ *menu.CallbackData) {
		if !app.runtimeAvailable() {
			return
		}
		var text string
		var err error
		app.runWithRuntimeContext(func(ctx context.Context) {
			text, err = wailsRuntime.ClipboardGetText(ctx)
		})
		if err != nil {
			return
		}
		app.emitEvent("menu:paste", text)
	})

	// Select All
	editMenu.AddText("Select All", keys.CmdOrCtrl("a"), func(_ *menu.CallbackData) {
		// This will be handled by the frontend
		if app.runtimeAvailable() {
			app.emitEvent("menu:selectAll")
		}
	})
}

// createViewMenu creates the View menu with consistent items across platforms
func createViewMenu(appMenu *menu.Menu, app *App) {
	viewMenu := appMenu.AddSubmenu("View")

	// Command Palette — the primary way to jump to any command or object. Placed
	// first (as in VS Code's View menu) so the shortcut is discoverable. The
	// frontend binds the same Cmd/Ctrl+Shift+P shortcut; the click emits an event
	// the palette listens for and opens through its guarded open path, so firing
	// both the native accelerator and the web shortcut is harmless.
	viewMenu.AddText("Command Palette", keys.Combo("p", keys.ShiftKey, keys.CmdOrCtrlKey), emitMenuEvent(app, "open-command-palette"))

	viewMenu.AddSeparator()
	addZoomMenuItems(viewMenu, app)
	viewMenu.AddSeparator()
	addViewToggleMenuItems(viewMenu, app)

	// macOS will automatically add "Enter Full Screen" after this separator
	if runtime.GOOS == "darwin" {
		viewMenu.AddSeparator()
	}
}

func addZoomMenuItems(viewMenu *menu.Menu, app *App) {
	// Zoom controls
	//
	// On Windows the Wails v2 keyMap has no entries for "+" or "-", so native
	// accelerators silently become no-ops. We embed the shortcut hint in the
	// menu label instead (Win32 renders text after \t right-aligned) and let
	// the frontend keyboard shortcuts handle the actual keypresses.
	zoomInLabel := "Zoom In"
	zoomOutLabel := "Zoom Out"
	resetZoomLabel := "Reset Zoom"
	var zoomInAccel, zoomOutAccel, resetZoomAccel *keys.Accelerator

	if runtime.GOOS == "windows" {
		zoomInLabel = "Zoom In\tCtrl+="
		zoomOutLabel = "Zoom Out\tCtrl+-"
		resetZoomLabel = "Reset Zoom\tCtrl+0"
	} else {
		zoomInAccel = keys.CmdOrCtrl("+")
		zoomOutAccel = keys.CmdOrCtrl("-")
		resetZoomAccel = keys.CmdOrCtrl("0")
	}

	viewMenu.AddText(zoomInLabel, zoomInAccel, asyncMenuCallback(func() { app.emitEvent("zoom-in") }))
	viewMenu.AddText(zoomOutLabel, zoomOutAccel, asyncMenuCallback(func() { app.emitEvent("zoom-out") }))
	viewMenu.AddText(resetZoomLabel, resetZoomAccel, asyncMenuCallback(func() { app.emitEvent("zoom-reset") }))
}

func addViewToggleMenuItems(viewMenu *menu.Menu, app *App) {
	// Dynamic sidebar menu item text
	sidebarText := "Hide Sidebar"
	if !app.IsSidebarVisible() {
		sidebarText = "Show Sidebar"
	}

	viewMenu.AddText(sidebarText, keys.CmdOrCtrl("b"), asyncErrorMenuCallback("Failed to toggle sidebar:", app.ToggleSidebar))
	viewMenu.AddText("Diff Objects", keys.CmdOrCtrl("d"), asyncErrorMenuCallback("Failed to toggle object diff:", app.ToggleObjectDiff))

	// Dynamic Application Logs Panel menu item text
	logsText := "Show Application Logs"
	if app.IsAppLogsPanelVisible() {
		logsText = "Hide Application Logs"
	}

	viewMenu.AddText(logsText, keys.Combo("l", keys.ShiftKey, keys.ControlKey), asyncErrorMenuCallback("Failed to toggle Application Logs Panel:", app.ToggleAppLogsPanel))

	// Dynamic Diagnostics panel menu item text
	diagnosticsText := "Show Diagnostics Panel"
	if app.IsDiagnosticsPanelVisible() {
		diagnosticsText = "Hide Diagnostics Panel"
	}

	viewMenu.AddText(diagnosticsText, keys.Combo("d", keys.ShiftKey, keys.ControlKey), asyncErrorMenuCallback("Failed to toggle diagnostics panel:", app.ToggleDiagnosticsPanel))
}

func emitMenuEvent(app *App, event string) func(*menu.CallbackData) {
	return func(_ *menu.CallbackData) {
		app.emitEvent(event)
	}
}

func asyncErrorMenuCallback(prefix string, action func() error) func(*menu.CallbackData) {
	return func(_ *menu.CallbackData) {
		go func() {
			if err := action(); err != nil {
				println(prefix, err.Error())
			}
		}()
	}
}

// createDebugMenu exposes development-only debug overlays.
func createDebugMenu(appMenu *menu.Menu, app *App) {
	debugMenu := appMenu.AddSubmenu("Debug")

	debugMenu.AddText("Open Inspector", keys.Combo("f12", keys.ShiftKey, keys.CmdOrCtrlKey), func(_ *menu.CallbackData) {
		if app.runtimeAvailable() {
			app.emitEvent("debug:open-inspector")
		}
	})

	debugMenu.AddSeparator()

	addDebugOverlayMenuItem(debugMenu, app, "Keyboard Focus Overlay", "k", "debug:toggle-focus-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Panel Debug Overlay", "p", "debug:toggle-panel-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Map Debug Overlay", "m", "debug:toggle-map-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Icon Debug Overlay", "i", "debug:toggle-icon-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Error Boundary Tests", "e", "debug:toggle-error-overlay")
}

func addDebugOverlayMenuItem(debugMenu *menu.Menu, app *App, label string, key string, event string) {
	debugMenu.AddText(label, keys.Combo(key, keys.ControlKey, keys.OptionOrAltKey), func(_ *menu.CallbackData) {
		if app.runtimeAvailable() {
			app.emitEvent(event)
		}
	})
}

// createWindowMenu creates the Window menu with OS-specific items
func createWindowMenu(appMenu *menu.Menu, app *App) {
	windowMenu := appMenu.AddSubmenu("Window")
	addWindowMenuAction(windowMenu, app, "Minimize", keys.CmdOrCtrl("m"), wailsRuntime.WindowMinimise)
	switch runtime.GOOS {
	case "darwin":
		addDarwinWindowMenu(windowMenu, app)
	case "windows":
		addWindowMenuAction(windowMenu, app, "Maximize", nil, wailsRuntime.WindowMaximise)
		addWindowMenuAction(windowMenu, app, "Restore", nil, wailsRuntime.WindowUnmaximise)
	default: // linux and other unix-like systems
		addWindowMenuAction(windowMenu, app, "Maximize", nil, wailsRuntime.WindowToggleMaximise)
	}
}

func addWindowMenuAction(windowMenu *menu.Menu, app *App, label string, accelerator *keys.Accelerator, action func(context.Context)) {
	windowMenu.AddText(label, accelerator, func(_ *menu.CallbackData) {
		go func() {
			app.runWithRuntimeContext(action)
		}()
	})
}

func addDarwinWindowMenu(windowMenu *menu.Menu, app *App) {
	addWindowMenuAction(windowMenu, app, "Zoom", nil, wailsRuntime.WindowToggleMaximise)
	windowMenu.AddSeparator()
	windowMenu.AddText("Bring All to Front", nil, func(_ *menu.CallbackData) {
		go bringAllWindowsToFront(app)
	})
	windowMenu.AddSeparator()
}

func bringAllWindowsToFront(app *App) {
	app.runWithRuntimeContext(func(ctx context.Context) {
		wailsRuntime.WindowShow(ctx)
		wailsRuntime.WindowSetAlwaysOnTop(ctx, true)
		wailsRuntime.WindowSetAlwaysOnTop(ctx, false)
	})
}

// createHelpMenu creates the Help menu for Windows and Linux (macOS uses the app menu instead)
func createHelpMenu(appMenu *menu.Menu, app *App) {
	if runtime.GOOS == "darwin" {
		return
	}

	helpMenu := appMenu.AddSubmenu("Help")

	helpMenu.AddText("About Luxury Yacht", nil, func(_ *menu.CallbackData) {
		go func() {
			app.ShowAbout()
		}()
	})
}
