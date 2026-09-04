package backend

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type menuController interface {
	ExecuteApplicationMenuCommand(string, ApplicationMenuCommand) error
	IsSidebarVisible() bool
	IsAppLogsPanelVisible() bool
	IsDiagnosticsPanelVisible() bool
	setApplicationMenu(*application.Menu)
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
	addMenuText(appSubmenu, "About Luxury Yacht", "", applicationMenuCallback(app, ApplicationMenuCommandAbout))
	addMenuText(appSubmenu, "Check for Updates…", "", applicationMenuCallback(app, ApplicationMenuCommandCheckForUpdates))
	appSubmenu.AddSeparator()
	addMenuText(appSubmenu, "Settings...", "CmdOrCtrl+,", applicationMenuCallback(app, ApplicationMenuCommandSettings))
	addMenuText(appSubmenu, "Hide Luxury Yacht", "CmdOrCtrl+h", applicationMenuCallback(app, ApplicationMenuCommandHide))
	addMenuText(appSubmenu, "Quit", "CmdOrCtrl+q", applicationMenuCallback(app, ApplicationMenuCommandQuit))
}

func addFileMenu(appMenu *application.Menu, app menuController) {
	fileMenu := appMenu.AddSubmenu("File")
	addMenuText(fileMenu, "New Window", "CmdOrCtrl+n", applicationMenuCallback(app, ApplicationMenuCommandNewWindow))
	fileMenu.AddSeparator()
	addMenuText(fileMenu, "Open Cluster", "CmdOrCtrl+o", applicationMenuCallback(app, ApplicationMenuCommandOpenCluster))
	addMenuText(fileMenu, "Close", "CmdOrCtrl+w", applicationMenuCallback(app, ApplicationMenuCommandClose))
	if runtime.GOOS != "darwin" {
		addDesktopFileMenuItems(fileMenu, app)
	}
}

func addDesktopFileMenuItems(fileMenu *application.Menu, app menuController) {
	fileMenu.AddSeparator()
	addMenuText(fileMenu, "Settings...", "CmdOrCtrl+,", applicationMenuCallback(app, ApplicationMenuCommandSettings))
	fileMenu.AddSeparator()
	exitLabel := "Quit"
	if runtime.GOOS == "windows" {
		exitLabel = "Exit"
	}
	addMenuText(fileMenu, exitLabel, "CmdOrCtrl+q", applicationMenuCallback(app, ApplicationMenuCommandQuit))
}

func applicationMenuCallback(app menuController, command ApplicationMenuCommand) func() {
	return func() {
		if err := app.ExecuteApplicationMenuCommand("", command); err != nil {
			println("Failed to execute application menu command:", err.Error())
		}
	}
}

func createEditMenu(appMenu *application.Menu, app menuController) {
	editMenu := appMenu.AddSubmenu("Edit")
	addMenuText(editMenu, "Cut", "CmdOrCtrl+x", applicationMenuCallback(app, ApplicationMenuCommandCut))
	addMenuText(editMenu, "Copy", "CmdOrCtrl+c", applicationMenuCallback(app, ApplicationMenuCommandCopy))
	addMenuText(editMenu, "Paste", "CmdOrCtrl+v", applicationMenuCallback(app, ApplicationMenuCommandPaste))
	addMenuText(editMenu, "Select All", "CmdOrCtrl+a", applicationMenuCallback(app, ApplicationMenuCommandSelectAll))
}

func createViewMenu(appMenu *application.Menu, app menuController) {
	viewMenu := appMenu.AddSubmenu("View")
	addMenuText(viewMenu, "Command Palette", "CmdOrCtrl+Shift+p", applicationMenuCallback(app, ApplicationMenuCommandCommandPalette))
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
	zoomInAccelerator := zoomInAccelerator(runtime.GOOS)
	zoomOutAccelerator := "CmdOrCtrl+-"
	resetZoomAccelerator := "CmdOrCtrl+0"
	if runtime.GOOS == "windows" {
		zoomInLabel = "Zoom In\tCtrl+="
		zoomOutLabel = "Zoom Out\tCtrl+-"
		resetZoomLabel = "Reset Zoom\tCtrl+0"
		zoomOutAccelerator = ""
		resetZoomAccelerator = ""
	}
	addMenuText(viewMenu, zoomInLabel, zoomInAccelerator, applicationMenuCallback(app, ApplicationMenuCommandZoomIn))
	addMenuText(viewMenu, zoomOutLabel, zoomOutAccelerator, applicationMenuCallback(app, ApplicationMenuCommandZoomOut))
	addMenuText(viewMenu, resetZoomLabel, resetZoomAccelerator, applicationMenuCallback(app, ApplicationMenuCommandZoomReset))
}

func zoomInAccelerator(goos string) string {
	if goos == "windows" {
		return ""
	}
	return "CmdOrCtrl+="
}

func addViewToggleMenuItems(viewMenu *application.Menu, app menuController) {
	sidebarText := "Hide Sidebar"
	if !app.IsSidebarVisible() {
		sidebarText = "Show Sidebar"
	}
	addMenuText(viewMenu, sidebarText, "CmdOrCtrl+b", applicationMenuCallback(app, ApplicationMenuCommandToggleSidebar))
	addMenuText(viewMenu, "Diff Objects", "CmdOrCtrl+d", applicationMenuCallback(app, ApplicationMenuCommandToggleObjectDiff))

	logsText := "Show Application Logs"
	if app.IsAppLogsPanelVisible() {
		logsText = "Hide Application Logs"
	}
	addMenuText(viewMenu, logsText, "Ctrl+Shift+l", applicationMenuCallback(app, ApplicationMenuCommandToggleAppLogs))

	diagnosticsText := "Show Diagnostics Panel"
	if app.IsDiagnosticsPanelVisible() {
		diagnosticsText = "Hide Diagnostics Panel"
	}
	addMenuText(viewMenu, diagnosticsText, "Ctrl+Shift+d", applicationMenuCallback(app, ApplicationMenuCommandToggleDiagnostics))
}

func createDebugMenu(appMenu *application.Menu, app menuController) {
	debugMenu := appMenu.AddSubmenu("Debug")
	addMenuText(debugMenu, "Open Inspector", "CmdOrCtrl+Shift+f12", applicationMenuCallback(app, ApplicationMenuCommandOpenInspector))
	debugMenu.AddSeparator()
	addDebugOverlayMenuItem(debugMenu, app, "Keyboard Focus Overlay", "k", ApplicationMenuCommandToggleFocusDebug)
	addDebugOverlayMenuItem(debugMenu, app, "Panel Debug Overlay", "p", ApplicationMenuCommandTogglePanelDebug)
	addDebugOverlayMenuItem(debugMenu, app, "Map Debug Overlay", "m", ApplicationMenuCommandToggleMapDebug)
	addDebugOverlayMenuItem(debugMenu, app, "Icon Debug Overlay", "i", ApplicationMenuCommandToggleIconDebug)
	addDebugOverlayMenuItem(debugMenu, app, "Error Boundary Tests", "e", ApplicationMenuCommandToggleErrorDebug)
}

func addDebugOverlayMenuItem(debugMenu *application.Menu, app menuController, label, key string, command ApplicationMenuCommand) {
	addMenuText(debugMenu, label, "Ctrl+OptionOrAlt+"+key, applicationMenuCallback(app, command))
}

func createWindowMenu(appMenu *application.Menu, app menuController) {
	windowMenu := appMenu.AddSubmenu("Window")
	addWindowMenuAction(windowMenu, app, "Minimize", "CmdOrCtrl+m", ApplicationMenuCommandMinimise)
	switch runtime.GOOS {
	case "darwin":
		addDarwinWindowMenu(windowMenu, app)
	case "windows":
		addWindowMenuAction(windowMenu, app, "Maximize", "", ApplicationMenuCommandMaximise)
		addWindowMenuAction(windowMenu, app, "Restore", "", ApplicationMenuCommandRestore)
	default:
		addWindowMenuAction(windowMenu, app, "Maximize", "", ApplicationMenuCommandToggleMaximise)
	}
}

func addWindowMenuAction(windowMenu *application.Menu, app menuController, label, accelerator string, command ApplicationMenuCommand) {
	addMenuText(windowMenu, label, accelerator, applicationMenuCallback(app, command))
}

func addDarwinWindowMenu(windowMenu *application.Menu, app menuController) {
	addWindowMenuAction(windowMenu, app, "Zoom", "", ApplicationMenuCommandToggleMaximise)
	windowMenu.AddSeparator()
	addMenuText(windowMenu, "Bring All to Front", "", applicationMenuCallback(app, ApplicationMenuCommandBringAllToFront))
	windowMenu.AddSeparator()
}

func createHelpMenu(appMenu *application.Menu, app menuController) {
	if runtime.GOOS == "darwin" {
		return
	}
	addDesktopHelpMenu(appMenu, app)
}

func addDesktopHelpMenu(appMenu *application.Menu, app menuController) {
	helpMenu := appMenu.AddSubmenu("Help")
	addMenuText(helpMenu, "About Luxury Yacht", "", applicationMenuCallback(app, ApplicationMenuCommandAbout))
	addMenuText(helpMenu, "Check for Updates…", "", applicationMenuCallback(app, ApplicationMenuCommandCheckForUpdates))
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
	if s != nil && s.runtimeAvailable() {
		s.QuitApplication()
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
