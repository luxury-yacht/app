package backend

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func addMenuText(menu *application.Menu, label, accelerator string, click func()) {
	item := menu.Add(label)
	if accelerator != "" {
		item.SetAccelerator(accelerator)
	}
	if click != nil {
		item.OnClick(func(*application.Context) { click() })
	}
}

// CreateMenu creates the application menu with OS-specific adjustments.
func CreateMenu(app *App) *application.Menu {
	appMenu := application.NewMenu()
	app.menu = appMenu
	populateMenu(appMenu, app)
	return appMenu
}

func populateMenu(appMenu *application.Menu, app *App) {
	createApplicationMenu(appMenu, app)
	createEditMenu(appMenu, app)
	createViewMenu(appMenu, app)
	createWindowMenu(appMenu, app)
	if appDebugMenuEnabled {
		createDebugMenu(appMenu, app)
	}
	createHelpMenu(appMenu, app)
}

func createApplicationMenu(appMenu *application.Menu, app *App) {
	if runtime.GOOS == "darwin" {
		addMacApplicationMenu(appMenu, app)
	}
	addFileMenu(appMenu, app)
}

func addMacApplicationMenu(appMenu *application.Menu, app *App) {
	appSubmenu := appMenu.AddSubmenu("Luxury Yacht")
	addMenuText(appSubmenu, "About Luxury Yacht", "", asyncMenuCallback(app.ShowAbout))
	appSubmenu.AddSeparator()
	addMenuText(appSubmenu, "Settings...", "CmdOrCtrl+,", asyncMenuCallback(app.ShowSettings))
	addMenuText(appSubmenu, "Hide Luxury Yacht", "CmdOrCtrl+h", hideApplicationCallback(app))
	addMenuText(appSubmenu, "Quit", "CmdOrCtrl+q", quitApplicationCallback(app))
}

func addFileMenu(appMenu *application.Menu, app *App) {
	fileMenu := appMenu.AddSubmenu("File")
	addMenuText(fileMenu, "Open Cluster", "CmdOrCtrl+o", emitMenuEventWhenReady(app, "open-cluster"))
	addMenuText(fileMenu, "Close Cluster", "CmdOrCtrl+w", emitMenuEventWhenReady(app, "menu:close"))
	if runtime.GOOS != "darwin" {
		addDesktopFileMenuItems(fileMenu, app)
	}
}

func addDesktopFileMenuItems(fileMenu *application.Menu, app *App) {
	fileMenu.AddSeparator()
	addMenuText(fileMenu, "Settings...", "CmdOrCtrl+,", asyncMenuCallback(app.ShowSettings))
	fileMenu.AddSeparator()
	exitLabel := "Quit"
	if runtime.GOOS == "windows" {
		exitLabel = "Exit"
	}
	addMenuText(fileMenu, exitLabel, "CmdOrCtrl+q", quitApplicationCallback(app))
}

func asyncMenuCallback(action func()) func() {
	return func() { go action() }
}

func hideApplicationCallback(app *App) func() {
	return func() {
		go func() {
			if app.runtimeAvailable() && app.wailsApplication != nil {
				app.wailsApplication.Hide()
			}
		}()
	}
}

func quitApplicationCallback(app *App) func() {
	return func() {
		if app.runtimeAvailable() && app.wailsApplication != nil {
			app.wailsApplication.Quit()
		}
	}
}

func emitMenuEventWhenReady(app *App, event string) func() {
	return func() {
		if app.runtimeAvailable() {
			app.emitEvent(event)
		}
	}
}

func createEditMenu(appMenu *application.Menu, app *App) {
	editMenu := appMenu.AddSubmenu("Edit")
	addMenuText(editMenu, "Cut", "CmdOrCtrl+x", emitMenuEventWhenReady(app, "menu:cut"))
	addMenuText(editMenu, "Copy", "CmdOrCtrl+c", emitMenuEventWhenReady(app, "menu:copy"))
	addMenuText(editMenu, "Paste", "CmdOrCtrl+v", func() {
		text, err := app.clipboardText()
		if err == nil {
			app.emitEvent("menu:paste", text)
		}
	})
	addMenuText(editMenu, "Select All", "CmdOrCtrl+a", emitMenuEventWhenReady(app, "menu:selectAll"))
}

func createViewMenu(appMenu *application.Menu, app *App) {
	viewMenu := appMenu.AddSubmenu("View")
	addMenuText(viewMenu, "Command Palette", "CmdOrCtrl+Shift+p", emitMenuEvent(app, "open-command-palette"))
	viewMenu.AddSeparator()
	addZoomMenuItems(viewMenu, app)
	viewMenu.AddSeparator()
	addViewToggleMenuItems(viewMenu, app)
	if runtime.GOOS == "darwin" {
		viewMenu.AddSeparator()
	}
}

func addZoomMenuItems(viewMenu *application.Menu, app *App) {
	zoomInLabel := "Zoom In"
	zoomOutLabel := "Zoom Out"
	resetZoomLabel := "Reset Zoom"
	zoomInAccelerator := "CmdOrCtrl+plus"
	zoomOutAccelerator := "CmdOrCtrl+-"
	resetZoomAccelerator := "CmdOrCtrl+0"
	if runtime.GOOS == "windows" {
		zoomInLabel = "Zoom In\tCtrl+="
		zoomOutLabel = "Zoom Out\tCtrl+-"
		resetZoomLabel = "Reset Zoom\tCtrl+0"
		zoomInAccelerator = ""
		zoomOutAccelerator = ""
		resetZoomAccelerator = ""
	}
	addMenuText(viewMenu, zoomInLabel, zoomInAccelerator, asyncMenuCallback(func() { app.emitEvent("zoom-in") }))
	addMenuText(viewMenu, zoomOutLabel, zoomOutAccelerator, asyncMenuCallback(func() { app.emitEvent("zoom-out") }))
	addMenuText(viewMenu, resetZoomLabel, resetZoomAccelerator, asyncMenuCallback(func() { app.emitEvent("zoom-reset") }))
}

func addViewToggleMenuItems(viewMenu *application.Menu, app *App) {
	sidebarText := "Hide Sidebar"
	if !app.IsSidebarVisible() {
		sidebarText = "Show Sidebar"
	}
	addMenuText(viewMenu, sidebarText, "CmdOrCtrl+b", asyncErrorMenuCallback("Failed to toggle sidebar:", app.ToggleSidebar))
	addMenuText(viewMenu, "Diff Objects", "CmdOrCtrl+d", asyncErrorMenuCallback("Failed to toggle object diff:", app.ToggleObjectDiff))

	logsText := "Show Application Logs"
	if app.IsAppLogsPanelVisible() {
		logsText = "Hide Application Logs"
	}
	addMenuText(viewMenu, logsText, "Ctrl+Shift+l", asyncErrorMenuCallback("Failed to toggle Application Logs Panel:", app.ToggleAppLogsPanel))

	diagnosticsText := "Show Diagnostics Panel"
	if app.IsDiagnosticsPanelVisible() {
		diagnosticsText = "Hide Diagnostics Panel"
	}
	addMenuText(viewMenu, diagnosticsText, "Ctrl+Shift+d", asyncErrorMenuCallback("Failed to toggle diagnostics panel:", app.ToggleDiagnosticsPanel))
}

func emitMenuEvent(app *App, event string) func() {
	return func() { app.emitEvent(event) }
}

func asyncErrorMenuCallback(prefix string, action func() error) func() {
	return func() {
		go func() {
			if err := action(); err != nil {
				println(prefix, err.Error())
			}
		}()
	}
}

func createDebugMenu(appMenu *application.Menu, app *App) {
	debugMenu := appMenu.AddSubmenu("Debug")
	addMenuText(debugMenu, "Open Inspector", "CmdOrCtrl+Shift+f12", emitMenuEventWhenReady(app, "debug:open-inspector"))
	debugMenu.AddSeparator()
	addDebugOverlayMenuItem(debugMenu, app, "Keyboard Focus Overlay", "k", "debug:toggle-focus-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Panel Debug Overlay", "p", "debug:toggle-panel-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Map Debug Overlay", "m", "debug:toggle-map-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Icon Debug Overlay", "i", "debug:toggle-icon-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Error Boundary Tests", "e", "debug:toggle-error-overlay")
}

func addDebugOverlayMenuItem(debugMenu *application.Menu, app *App, label, key, event string) {
	addMenuText(debugMenu, label, "Ctrl+OptionOrAlt+"+key, emitMenuEventWhenReady(app, event))
}

func createWindowMenu(appMenu *application.Menu, app *App) {
	windowMenu := appMenu.AddSubmenu("Window")
	addWindowMenuAction(windowMenu, app, "Minimize", "CmdOrCtrl+m", app.minimiseMainWindow)
	switch runtime.GOOS {
	case "darwin":
		addDarwinWindowMenu(windowMenu, app)
	case "windows":
		addWindowMenuAction(windowMenu, app, "Maximize", "", app.maximiseMainWindow)
		addWindowMenuAction(windowMenu, app, "Restore", "", app.restoreMainWindow)
	default:
		addWindowMenuAction(windowMenu, app, "Maximize", "", app.toggleMainWindowMaximise)
	}
}

func addWindowMenuAction(windowMenu *application.Menu, _ *App, label, accelerator string, action func() error) {
	addMenuText(windowMenu, label, accelerator, func() { go func() { _ = action() }() })
}

func addDarwinWindowMenu(windowMenu *application.Menu, app *App) {
	addWindowMenuAction(windowMenu, app, "Zoom", "", app.toggleMainWindowMaximise)
	windowMenu.AddSeparator()
	addMenuText(windowMenu, "Bring All to Front", "", func() { go bringAllWindowsToFront(app) })
	windowMenu.AddSeparator()
}

func bringAllWindowsToFront(app *App) {
	window, err := app.mainWindowWhenReady()
	if err == nil {
		window.Show()
		if window.IsMinimised() {
			window.Restore()
		}
		window.Focus()
	}
}

func createHelpMenu(appMenu *application.Menu, app *App) {
	if runtime.GOOS == "darwin" {
		return
	}
	helpMenu := appMenu.AddSubmenu("Help")
	addMenuText(helpMenu, "About Luxury Yacht", "", asyncMenuCallback(app.ShowAbout))
}
