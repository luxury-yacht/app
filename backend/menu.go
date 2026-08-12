package backend

import "runtime"

// MenuModel is the framework-neutral native menu contract owned by the
// backend. The Wails adapter materialises it into one persistent native menu.
type MenuModel struct {
	Items []*MenuItemModel
}

type MenuItemModel struct {
	Label       string
	Accelerator string
	Separator   bool
	SubMenu     *MenuModel
	Click       func()
}

func NewMenuModel() *MenuModel {
	return &MenuModel{}
}

func (m *MenuModel) AddSubmenu(label string) *MenuModel {
	submenu := NewMenuModel()
	m.Items = append(m.Items, &MenuItemModel{Label: label, SubMenu: submenu})
	return submenu
}

func (m *MenuModel) AddSeparator() {
	m.Items = append(m.Items, &MenuItemModel{Separator: true})
}

func (m *MenuModel) AddText(label, accelerator string, click func()) {
	m.Items = append(m.Items, &MenuItemModel{
		Label:       label,
		Accelerator: accelerator,
		Click:       click,
	})
}

// CreateMenu creates the application menu with OS-specific adjustments.
func CreateMenu(app *App) *MenuModel {
	appMenu := NewMenuModel()
	createApplicationMenu(appMenu, app)
	createEditMenu(appMenu, app)
	createViewMenu(appMenu, app)
	createWindowMenu(appMenu, app)
	if appDebugMenuEnabled {
		createDebugMenu(appMenu, app)
	}
	createHelpMenu(appMenu, app)
	return appMenu
}

func createApplicationMenu(appMenu *MenuModel, app *App) {
	if runtime.GOOS == "darwin" {
		addMacApplicationMenu(appMenu, app)
	}
	addFileMenu(appMenu, app)
}

func addMacApplicationMenu(appMenu *MenuModel, app *App) {
	appSubmenu := appMenu.AddSubmenu("Luxury Yacht")
	appSubmenu.AddText("About Luxury Yacht", "", asyncMenuCallback(app.ShowAbout))
	appSubmenu.AddSeparator()
	appSubmenu.AddText("Settings...", "CmdOrCtrl+,", asyncMenuCallback(app.ShowSettings))
	appSubmenu.AddText("Hide Luxury Yacht", "CmdOrCtrl+h", hideApplicationCallback(app))
	appSubmenu.AddText("Quit", "CmdOrCtrl+q", quitApplicationCallback(app))
}

func addFileMenu(appMenu *MenuModel, app *App) {
	fileMenu := appMenu.AddSubmenu("File")
	fileMenu.AddText("Open Cluster", "CmdOrCtrl+o", emitMenuEventWhenReady(app, "open-cluster"))
	fileMenu.AddText("Close Cluster", "CmdOrCtrl+w", emitMenuEventWhenReady(app, "menu:close"))
	if runtime.GOOS != "darwin" {
		addDesktopFileMenuItems(fileMenu, app)
	}
}

func addDesktopFileMenuItems(fileMenu *MenuModel, app *App) {
	fileMenu.AddSeparator()
	fileMenu.AddText("Settings...", "CmdOrCtrl+,", asyncMenuCallback(app.ShowSettings))
	fileMenu.AddSeparator()
	exitLabel := "Quit"
	if runtime.GOOS == "windows" {
		exitLabel = "Exit"
	}
	fileMenu.AddText(exitLabel, "CmdOrCtrl+q", quitApplicationCallback(app))
}

func asyncMenuCallback(action func()) func() {
	return func() { go action() }
}

func hideApplicationCallback(app *App) func() {
	return func() {
		go func() {
			if app.desktopAvailable() {
				app.desktop.HideApplication()
			}
		}()
	}
}

func quitApplicationCallback(app *App) func() {
	return func() {
		if app.desktopAvailable() {
			app.desktop.QuitApplication()
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

func createEditMenu(appMenu *MenuModel, app *App) {
	editMenu := appMenu.AddSubmenu("Edit")
	editMenu.AddText("Cut", "CmdOrCtrl+x", emitMenuEventWhenReady(app, "menu:cut"))
	editMenu.AddText("Copy", "CmdOrCtrl+c", emitMenuEventWhenReady(app, "menu:copy"))
	editMenu.AddText("Paste", "CmdOrCtrl+v", func() {
		if !app.desktopAvailable() {
			return
		}
		text, err := app.desktop.ClipboardText()
		if err == nil {
			app.emitEvent("menu:paste", text)
		}
	})
	editMenu.AddText("Select All", "CmdOrCtrl+a", emitMenuEventWhenReady(app, "menu:selectAll"))
}

func createViewMenu(appMenu *MenuModel, app *App) {
	viewMenu := appMenu.AddSubmenu("View")
	viewMenu.AddText("Command Palette", "CmdOrCtrl+Shift+p", emitMenuEvent(app, "open-command-palette"))
	viewMenu.AddSeparator()
	addZoomMenuItems(viewMenu, app)
	viewMenu.AddSeparator()
	addViewToggleMenuItems(viewMenu, app)
	if runtime.GOOS == "darwin" {
		viewMenu.AddSeparator()
	}
}

func addZoomMenuItems(viewMenu *MenuModel, app *App) {
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
	viewMenu.AddText(zoomInLabel, zoomInAccelerator, asyncMenuCallback(func() { app.emitEvent("zoom-in") }))
	viewMenu.AddText(zoomOutLabel, zoomOutAccelerator, asyncMenuCallback(func() { app.emitEvent("zoom-out") }))
	viewMenu.AddText(resetZoomLabel, resetZoomAccelerator, asyncMenuCallback(func() { app.emitEvent("zoom-reset") }))
}

func addViewToggleMenuItems(viewMenu *MenuModel, app *App) {
	sidebarText := "Hide Sidebar"
	if !app.IsSidebarVisible() {
		sidebarText = "Show Sidebar"
	}
	viewMenu.AddText(sidebarText, "CmdOrCtrl+b", asyncErrorMenuCallback("Failed to toggle sidebar:", app.ToggleSidebar))
	viewMenu.AddText("Diff Objects", "CmdOrCtrl+d", asyncErrorMenuCallback("Failed to toggle object diff:", app.ToggleObjectDiff))

	logsText := "Show Application Logs"
	if app.IsAppLogsPanelVisible() {
		logsText = "Hide Application Logs"
	}
	viewMenu.AddText(logsText, "Ctrl+Shift+l", asyncErrorMenuCallback("Failed to toggle Application Logs Panel:", app.ToggleAppLogsPanel))

	diagnosticsText := "Show Diagnostics Panel"
	if app.IsDiagnosticsPanelVisible() {
		diagnosticsText = "Hide Diagnostics Panel"
	}
	viewMenu.AddText(diagnosticsText, "Ctrl+Shift+d", asyncErrorMenuCallback("Failed to toggle diagnostics panel:", app.ToggleDiagnosticsPanel))
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

func createDebugMenu(appMenu *MenuModel, app *App) {
	debugMenu := appMenu.AddSubmenu("Debug")
	debugMenu.AddText("Open Inspector", "CmdOrCtrl+Shift+f12", emitMenuEventWhenReady(app, "debug:open-inspector"))
	debugMenu.AddSeparator()
	addDebugOverlayMenuItem(debugMenu, app, "Keyboard Focus Overlay", "k", "debug:toggle-focus-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Panel Debug Overlay", "p", "debug:toggle-panel-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Map Debug Overlay", "m", "debug:toggle-map-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Icon Debug Overlay", "i", "debug:toggle-icon-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Error Boundary Tests", "e", "debug:toggle-error-overlay")
}

func addDebugOverlayMenuItem(debugMenu *MenuModel, app *App, label, key, event string) {
	debugMenu.AddText(label, "Ctrl+OptionOrAlt+"+key, emitMenuEventWhenReady(app, event))
}

func createWindowMenu(appMenu *MenuModel, app *App) {
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

func addWindowMenuAction(windowMenu *MenuModel, app *App, label, accelerator string, action func() error) {
	windowMenu.AddText(label, accelerator, func() {
		go func() {
			if app.desktopAvailable() {
				_ = action()
			}
		}()
	})
}

func addDarwinWindowMenu(windowMenu *MenuModel, app *App) {
	addWindowMenuAction(windowMenu, app, "Zoom", "", app.toggleMainWindowMaximise)
	windowMenu.AddSeparator()
	windowMenu.AddText("Bring All to Front", "", func() { go bringAllWindowsToFront(app) })
	windowMenu.AddSeparator()
}

func bringAllWindowsToFront(app *App) {
	if app.desktopAvailable() {
		_ = app.desktop.BringMainWindowToFront()
	}
}

func createHelpMenu(appMenu *MenuModel, app *App) {
	if runtime.GOOS == "darwin" {
		return
	}
	helpMenu := appMenu.AddSubmenu("Help")
	helpMenu.AddText("About Luxury Yacht", "", asyncMenuCallback(app.ShowAbout))
}
