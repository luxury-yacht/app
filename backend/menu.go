package backend

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type menuController interface {
	ShowAbout()
	showAboutAndCheckForUpdates()
	ShowSettings()
	runtimeAvailable() bool
	emitCurrentWindowEvent(string, ...interface{})
	clipboardText() (string, error)
	ToggleSidebar() error
	ToggleObjectDiff() error
	ToggleAppLogsPanel() error
	ToggleDiagnosticsPanel() error
	IsSidebarVisible() bool
	IsAppLogsPanelVisible() bool
	IsDiagnosticsPanelVisible() bool
	minimiseCurrentWindow() error
	maximiseCurrentWindow() error
	restoreCurrentWindow() error
	toggleCurrentWindowMaximise() error
	setApplicationMenu(*application.Menu)
	createWorkspaceWindowFromMenu()
	hideApplicationFromMenu()
	quitApplicationFromMenu()
	bringAllWindowsToFront()
}

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
func CreateMenu(app menuController) *application.Menu {
	appMenu := application.NewMenu()
	app.setApplicationMenu(appMenu)
	populateMenu(appMenu, app)
	return appMenu
}

func populateMenu(appMenu *application.Menu, app menuController) {
	createApplicationMenu(appMenu, app)
	createEditMenu(appMenu, app)
	createViewMenu(appMenu, app)
	createWindowMenu(appMenu, app)
	if appDebugMenuEnabled {
		createDebugMenu(appMenu, app)
	}
	createHelpMenu(appMenu, app)
}

func createApplicationMenu(appMenu *application.Menu, app menuController) {
	if runtime.GOOS == "darwin" {
		addMacApplicationMenu(appMenu, app)
	}
	addFileMenu(appMenu, app)
}

func addMacApplicationMenu(appMenu *application.Menu, app menuController) {
	appSubmenu := appMenu.AddSubmenu("Luxury Yacht")
	addMenuText(appSubmenu, "About Luxury Yacht", "", menuCallback(app.ShowAbout))
	addMenuText(appSubmenu, "Check for Updates…", "", menuCallback(app.showAboutAndCheckForUpdates))
	appSubmenu.AddSeparator()
	addMenuText(appSubmenu, "Settings...", "CmdOrCtrl+,", menuCallback(app.ShowSettings))
	addMenuText(appSubmenu, "Hide Luxury Yacht", "CmdOrCtrl+h", hideApplicationCallback(app))
	addMenuText(appSubmenu, "Quit", "CmdOrCtrl+q", quitApplicationCallback(app))
}

func addFileMenu(appMenu *application.Menu, app menuController) {
	fileMenu := appMenu.AddSubmenu("File")
	addMenuText(fileMenu, "New Window", "CmdOrCtrl+n", app.createWorkspaceWindowFromMenu)
	fileMenu.AddSeparator()
	addMenuText(fileMenu, "Open Cluster", "CmdOrCtrl+o", emitMenuEventWhenReady(app, "open-cluster"))
	addMenuText(fileMenu, "Close", "CmdOrCtrl+w", emitMenuEventWhenReady(app, "menu:close"))
	if runtime.GOOS != "darwin" {
		addDesktopFileMenuItems(fileMenu, app)
	}
}

func addDesktopFileMenuItems(fileMenu *application.Menu, app menuController) {
	fileMenu.AddSeparator()
	addMenuText(fileMenu, "Settings...", "CmdOrCtrl+,", menuCallback(app.ShowSettings))
	fileMenu.AddSeparator()
	exitLabel := "Quit"
	if runtime.GOOS == "windows" {
		exitLabel = "Exit"
	}
	addMenuText(fileMenu, exitLabel, "CmdOrCtrl+q", quitApplicationCallback(app))
}

func menuCallback(action func()) func() {
	return action
}

func hideApplicationCallback(app menuController) func() {
	return func() {
		go app.hideApplicationFromMenu()
	}
}

func quitApplicationCallback(app menuController) func() {
	return func() {
		app.quitApplicationFromMenu()
	}
}

func emitMenuEventWhenReady(app menuController, event string) func() {
	return func() {
		if app.runtimeAvailable() {
			app.emitCurrentWindowEvent(event)
		}
	}
}

func createEditMenu(appMenu *application.Menu, app menuController) {
	editMenu := appMenu.AddSubmenu("Edit")
	addMenuText(editMenu, "Cut", "CmdOrCtrl+x", emitMenuEventWhenReady(app, "menu:cut"))
	addMenuText(editMenu, "Copy", "CmdOrCtrl+c", emitMenuEventWhenReady(app, "menu:copy"))
	addMenuText(editMenu, "Paste", "CmdOrCtrl+v", func() {
		text, err := app.clipboardText()
		if err == nil {
			app.emitCurrentWindowEvent("menu:paste", text)
		}
	})
	addMenuText(editMenu, "Select All", "CmdOrCtrl+a", emitMenuEventWhenReady(app, "menu:selectAll"))
}

func createViewMenu(appMenu *application.Menu, app menuController) {
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

func addZoomMenuItems(viewMenu *application.Menu, app menuController) {
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
	addMenuText(viewMenu, zoomInLabel, zoomInAccelerator, menuCallback(func() { app.emitCurrentWindowEvent("zoom-in") }))
	addMenuText(viewMenu, zoomOutLabel, zoomOutAccelerator, menuCallback(func() { app.emitCurrentWindowEvent("zoom-out") }))
	addMenuText(viewMenu, resetZoomLabel, resetZoomAccelerator, menuCallback(func() { app.emitCurrentWindowEvent("zoom-reset") }))
}

func addViewToggleMenuItems(viewMenu *application.Menu, app menuController) {
	sidebarText := "Hide Sidebar"
	if !app.IsSidebarVisible() {
		sidebarText = "Show Sidebar"
	}
	addMenuText(viewMenu, sidebarText, "CmdOrCtrl+b", errorMenuCallback("Failed to toggle sidebar:", app.ToggleSidebar))
	addMenuText(viewMenu, "Diff Objects", "CmdOrCtrl+d", errorMenuCallback("Failed to toggle object diff:", app.ToggleObjectDiff))

	logsText := "Show Application Logs"
	if app.IsAppLogsPanelVisible() {
		logsText = "Hide Application Logs"
	}
	addMenuText(viewMenu, logsText, "Ctrl+Shift+l", errorMenuCallback("Failed to toggle Application Logs Panel:", app.ToggleAppLogsPanel))

	diagnosticsText := "Show Diagnostics Panel"
	if app.IsDiagnosticsPanelVisible() {
		diagnosticsText = "Hide Diagnostics Panel"
	}
	addMenuText(viewMenu, diagnosticsText, "Ctrl+Shift+d", errorMenuCallback("Failed to toggle diagnostics panel:", app.ToggleDiagnosticsPanel))
}

func emitMenuEvent(app menuController, event string) func() {
	return func() { app.emitCurrentWindowEvent(event) }
}

func errorMenuCallback(prefix string, action func() error) func() {
	return func() {
		if err := action(); err != nil {
			println(prefix, err.Error())
		}
	}
}

func createDebugMenu(appMenu *application.Menu, app menuController) {
	debugMenu := appMenu.AddSubmenu("Debug")
	addMenuText(debugMenu, "Open Inspector", "CmdOrCtrl+Shift+f12", emitMenuEventWhenReady(app, "debug:open-inspector"))
	debugMenu.AddSeparator()
	addDebugOverlayMenuItem(debugMenu, app, "Keyboard Focus Overlay", "k", "debug:toggle-focus-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Panel Debug Overlay", "p", "debug:toggle-panel-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Map Debug Overlay", "m", "debug:toggle-map-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Icon Debug Overlay", "i", "debug:toggle-icon-overlay")
	addDebugOverlayMenuItem(debugMenu, app, "Error Boundary Tests", "e", "debug:toggle-error-overlay")
}

func addDebugOverlayMenuItem(debugMenu *application.Menu, app menuController, label, key, event string) {
	addMenuText(debugMenu, label, "Ctrl+OptionOrAlt+"+key, emitMenuEventWhenReady(app, event))
}

func createWindowMenu(appMenu *application.Menu, app menuController) {
	windowMenu := appMenu.AddSubmenu("Window")
	addWindowMenuAction(windowMenu, "Minimize", "CmdOrCtrl+m", app.minimiseCurrentWindow)
	switch runtime.GOOS {
	case "darwin":
		addDarwinWindowMenu(windowMenu, app)
	case "windows":
		addWindowMenuAction(windowMenu, "Maximize", "", app.maximiseCurrentWindow)
		addWindowMenuAction(windowMenu, "Restore", "", app.restoreCurrentWindow)
	default:
		addWindowMenuAction(windowMenu, "Maximize", "", app.toggleCurrentWindowMaximise)
	}
}

func addWindowMenuAction(windowMenu *application.Menu, label, accelerator string, action func() error) {
	addMenuText(windowMenu, label, accelerator, func() { _ = action() })
}

func addDarwinWindowMenu(windowMenu *application.Menu, app menuController) {
	addWindowMenuAction(windowMenu, "Zoom", "", app.toggleCurrentWindowMaximise)
	windowMenu.AddSeparator()
	addMenuText(windowMenu, "Bring All to Front", "", func() { go bringAllWindowsToFront(app) })
	windowMenu.AddSeparator()
}

func bringAllWindowsToFront(app menuController) {
	app.bringAllWindowsToFront()
}

func createHelpMenu(appMenu *application.Menu, app menuController) {
	if runtime.GOOS == "darwin" {
		return
	}
	addDesktopHelpMenu(appMenu, app)
}

func addDesktopHelpMenu(appMenu *application.Menu, app menuController) {
	helpMenu := appMenu.AddSubmenu("Help")
	addMenuText(helpMenu, "About Luxury Yacht", "", menuCallback(app.ShowAbout))
	addMenuText(helpMenu, "Check for Updates…", "", menuCallback(app.showAboutAndCheckForUpdates))
}

func (s *DesktopShell) setApplicationMenu(menu *application.Menu) {
	s.menu = menu
}

func (s *DesktopShell) createWorkspaceWindowFromMenu() {
	if s != nil && s.createWorkspaceWindow != nil {
		s.createWorkspaceWindow()
	}
}

func (s *DesktopShell) hideApplicationFromMenu() {
	if s != nil && s.runtimeAvailable() && s.application != nil {
		s.application.Hide()
	}
}

func (s *DesktopShell) quitApplicationFromMenu() {
	if s != nil && s.runtimeAvailable() && s.application != nil {
		s.application.Quit()
	}
}

func (s *DesktopShell) bringAllWindowsToFront() {
	if s == nil || !s.runtimeAvailable() || s.application == nil {
		return
	}
	for _, window := range s.application.Window.GetAll() {
		window.Show()
		if window.IsMinimised() {
			window.Restore()
		}
		window.Focus()
	}
}
