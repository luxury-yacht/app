package backend

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type menuController interface {
	ExecuteWorkspaceMenuCommand(string, WorkspaceMenuCommand) error
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
	addMenuText(appSubmenu, "About Luxury Yacht", "", workspaceMenuCallback(app, WorkspaceMenuCommandAbout))
	addMenuText(appSubmenu, "Check for Updates…", "", workspaceMenuCallback(app, WorkspaceMenuCommandCheckForUpdates))
	appSubmenu.AddSeparator()
	addMenuText(appSubmenu, "Settings...", "CmdOrCtrl+,", workspaceMenuCallback(app, WorkspaceMenuCommandSettings))
	addMenuText(appSubmenu, "Hide Luxury Yacht", "CmdOrCtrl+h", workspaceMenuCallback(app, WorkspaceMenuCommandHide))
	addMenuText(appSubmenu, "Quit", "CmdOrCtrl+q", workspaceMenuCallback(app, WorkspaceMenuCommandQuit))
}

func addFileMenu(appMenu *application.Menu, app menuController) {
	fileMenu := appMenu.AddSubmenu("File")
	addMenuText(fileMenu, "New Window", "CmdOrCtrl+n", workspaceMenuCallback(app, WorkspaceMenuCommandNewWindow))
	fileMenu.AddSeparator()
	addMenuText(fileMenu, "Open Cluster", "CmdOrCtrl+o", workspaceMenuCallback(app, WorkspaceMenuCommandOpenCluster))
	addMenuText(fileMenu, "Close", "CmdOrCtrl+w", workspaceMenuCallback(app, WorkspaceMenuCommandClose))
	if runtime.GOOS != "darwin" {
		addDesktopFileMenuItems(fileMenu, app)
	}
}

func addDesktopFileMenuItems(fileMenu *application.Menu, app menuController) {
	fileMenu.AddSeparator()
	addMenuText(fileMenu, "Settings...", "CmdOrCtrl+,", workspaceMenuCallback(app, WorkspaceMenuCommandSettings))
	fileMenu.AddSeparator()
	exitLabel := "Quit"
	if runtime.GOOS == "windows" {
		exitLabel = "Exit"
	}
	addMenuText(fileMenu, exitLabel, "CmdOrCtrl+q", workspaceMenuCallback(app, WorkspaceMenuCommandQuit))
}

func workspaceMenuCallback(app menuController, command WorkspaceMenuCommand) func() {
	return func() {
		if err := app.ExecuteWorkspaceMenuCommand("", command); err != nil {
			println("Failed to execute workspace menu command:", err.Error())
		}
	}
}

func createEditMenu(appMenu *application.Menu, app menuController) {
	editMenu := appMenu.AddSubmenu("Edit")
	addMenuText(editMenu, "Cut", "CmdOrCtrl+x", workspaceMenuCallback(app, WorkspaceMenuCommandCut))
	addMenuText(editMenu, "Copy", "CmdOrCtrl+c", workspaceMenuCallback(app, WorkspaceMenuCommandCopy))
	addMenuText(editMenu, "Paste", "CmdOrCtrl+v", workspaceMenuCallback(app, WorkspaceMenuCommandPaste))
	addMenuText(editMenu, "Select All", "CmdOrCtrl+a", workspaceMenuCallback(app, WorkspaceMenuCommandSelectAll))
}

func createViewMenu(appMenu *application.Menu, app menuController) {
	viewMenu := appMenu.AddSubmenu("View")
	addMenuText(viewMenu, "Command Palette", "CmdOrCtrl+Shift+p", workspaceMenuCallback(app, WorkspaceMenuCommandCommandPalette))
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
	addMenuText(viewMenu, zoomInLabel, zoomInAccelerator, workspaceMenuCallback(app, WorkspaceMenuCommandZoomIn))
	addMenuText(viewMenu, zoomOutLabel, zoomOutAccelerator, workspaceMenuCallback(app, WorkspaceMenuCommandZoomOut))
	addMenuText(viewMenu, resetZoomLabel, resetZoomAccelerator, workspaceMenuCallback(app, WorkspaceMenuCommandZoomReset))
}

func addViewToggleMenuItems(viewMenu *application.Menu, app menuController) {
	sidebarText := "Hide Sidebar"
	if !app.IsSidebarVisible() {
		sidebarText = "Show Sidebar"
	}
	addMenuText(viewMenu, sidebarText, "CmdOrCtrl+b", workspaceMenuCallback(app, WorkspaceMenuCommandToggleSidebar))
	addMenuText(viewMenu, "Diff Objects", "CmdOrCtrl+d", workspaceMenuCallback(app, WorkspaceMenuCommandToggleObjectDiff))

	logsText := "Show Application Logs"
	if app.IsAppLogsPanelVisible() {
		logsText = "Hide Application Logs"
	}
	addMenuText(viewMenu, logsText, "Ctrl+Shift+l", workspaceMenuCallback(app, WorkspaceMenuCommandToggleAppLogs))

	diagnosticsText := "Show Diagnostics Panel"
	if app.IsDiagnosticsPanelVisible() {
		diagnosticsText = "Hide Diagnostics Panel"
	}
	addMenuText(viewMenu, diagnosticsText, "Ctrl+Shift+d", workspaceMenuCallback(app, WorkspaceMenuCommandToggleDiagnostics))
}

func createDebugMenu(appMenu *application.Menu, app menuController) {
	debugMenu := appMenu.AddSubmenu("Debug")
	addMenuText(debugMenu, "Open Inspector", "CmdOrCtrl+Shift+f12", workspaceMenuCallback(app, WorkspaceMenuCommandOpenInspector))
	debugMenu.AddSeparator()
	addDebugOverlayMenuItem(debugMenu, app, "Keyboard Focus Overlay", "k", WorkspaceMenuCommandToggleFocusDebug)
	addDebugOverlayMenuItem(debugMenu, app, "Panel Debug Overlay", "p", WorkspaceMenuCommandTogglePanelDebug)
	addDebugOverlayMenuItem(debugMenu, app, "Map Debug Overlay", "m", WorkspaceMenuCommandToggleMapDebug)
	addDebugOverlayMenuItem(debugMenu, app, "Icon Debug Overlay", "i", WorkspaceMenuCommandToggleIconDebug)
	addDebugOverlayMenuItem(debugMenu, app, "Error Boundary Tests", "e", WorkspaceMenuCommandToggleErrorDebug)
}

func addDebugOverlayMenuItem(debugMenu *application.Menu, app menuController, label, key string, command WorkspaceMenuCommand) {
	addMenuText(debugMenu, label, "Ctrl+OptionOrAlt+"+key, workspaceMenuCallback(app, command))
}

func createWindowMenu(appMenu *application.Menu, app menuController) {
	windowMenu := appMenu.AddSubmenu("Window")
	addWindowMenuAction(windowMenu, app, "Minimize", "CmdOrCtrl+m", WorkspaceMenuCommandMinimise)
	switch runtime.GOOS {
	case "darwin":
		addDarwinWindowMenu(windowMenu, app)
	case "windows":
		addWindowMenuAction(windowMenu, app, "Maximize", "", WorkspaceMenuCommandMaximise)
		addWindowMenuAction(windowMenu, app, "Restore", "", WorkspaceMenuCommandRestore)
	default:
		addWindowMenuAction(windowMenu, app, "Maximize", "", WorkspaceMenuCommandToggleMaximise)
	}
}

func addWindowMenuAction(windowMenu *application.Menu, app menuController, label, accelerator string, command WorkspaceMenuCommand) {
	addMenuText(windowMenu, label, accelerator, workspaceMenuCallback(app, command))
}

func addDarwinWindowMenu(windowMenu *application.Menu, app menuController) {
	addWindowMenuAction(windowMenu, app, "Zoom", "", WorkspaceMenuCommandToggleMaximise)
	windowMenu.AddSeparator()
	addMenuText(windowMenu, "Bring All to Front", "", workspaceMenuCallback(app, WorkspaceMenuCommandBringAllToFront))
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
	addMenuText(helpMenu, "About Luxury Yacht", "", workspaceMenuCallback(app, WorkspaceMenuCommandAbout))
	addMenuText(helpMenu, "Check for Updates…", "", workspaceMenuCallback(app, WorkspaceMenuCommandCheckForUpdates))
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
