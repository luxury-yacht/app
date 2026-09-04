package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ApplicationMenuCommand is the shared command identity used by the native macOS
// menu and by the app-rendered Windows/Linux accelerators.
type ApplicationMenuCommand string

const (
	ApplicationMenuCommandNewWindow         ApplicationMenuCommand = "new-window"
	ApplicationMenuCommandOpenCluster       ApplicationMenuCommand = "open-cluster"
	ApplicationMenuCommandClose             ApplicationMenuCommand = "close"
	ApplicationMenuCommandSettings          ApplicationMenuCommand = "settings"
	ApplicationMenuCommandQuit              ApplicationMenuCommand = "quit"
	ApplicationMenuCommandHide              ApplicationMenuCommand = "hide"
	ApplicationMenuCommandCut               ApplicationMenuCommand = "cut"
	ApplicationMenuCommandCopy              ApplicationMenuCommand = "copy"
	ApplicationMenuCommandPaste             ApplicationMenuCommand = "paste"
	ApplicationMenuCommandSelectAll         ApplicationMenuCommand = "select-all"
	ApplicationMenuCommandCommandPalette    ApplicationMenuCommand = "command-palette"
	ApplicationMenuCommandZoomIn            ApplicationMenuCommand = "zoom-in"
	ApplicationMenuCommandZoomOut           ApplicationMenuCommand = "zoom-out"
	ApplicationMenuCommandZoomReset         ApplicationMenuCommand = "zoom-reset"
	ApplicationMenuCommandToggleSidebar     ApplicationMenuCommand = "toggle-sidebar"
	ApplicationMenuCommandToggleObjectDiff  ApplicationMenuCommand = "toggle-object-diff"
	ApplicationMenuCommandToggleAppLogs     ApplicationMenuCommand = "toggle-app-logs"
	ApplicationMenuCommandToggleDiagnostics ApplicationMenuCommand = "toggle-diagnostics"
	ApplicationMenuCommandOpenInspector     ApplicationMenuCommand = "open-inspector"
	ApplicationMenuCommandToggleFocusDebug  ApplicationMenuCommand = "toggle-focus-debug"
	ApplicationMenuCommandTogglePanelDebug  ApplicationMenuCommand = "toggle-panel-debug"
	ApplicationMenuCommandToggleMapDebug    ApplicationMenuCommand = "toggle-map-debug"
	ApplicationMenuCommandToggleIconDebug   ApplicationMenuCommand = "toggle-icon-debug"
	ApplicationMenuCommandToggleErrorDebug  ApplicationMenuCommand = "toggle-error-debug"
	ApplicationMenuCommandMinimise          ApplicationMenuCommand = "minimise"
	ApplicationMenuCommandMaximise          ApplicationMenuCommand = "maximise"
	ApplicationMenuCommandRestore           ApplicationMenuCommand = "restore"
	ApplicationMenuCommandToggleMaximise    ApplicationMenuCommand = "toggle-maximise"
	ApplicationMenuCommandBringAllToFront   ApplicationMenuCommand = "bring-all-to-front"
	ApplicationMenuCommandAbout             ApplicationMenuCommand = "about"
	ApplicationMenuCommandCheckForUpdates   ApplicationMenuCommand = "check-for-updates"
)

type applicationMenuCaller struct {
	windowName string
	descriptor panelwindow.NativeDescriptor
}

func (s *DesktopShell) resolveApplicationMenuCaller(windowName string) (applicationMenuCaller, error) {
	if windowName == "" {
		window, err := s.currentWindowWhenReady()
		if err != nil {
			return applicationMenuCaller{}, err
		}
		windowName = window.Name()
	}
	descriptor, err := s.GetNativeWindowDescriptor(windowName)
	if err != nil {
		return applicationMenuCaller{}, err
	}
	switch descriptor.Role {
	case panelwindow.NativeRoleWorkspace:
		if descriptor.Workspace == nil || descriptor.Workspace.WindowName != windowName {
			return applicationMenuCaller{}, fmt.Errorf("workspace descriptor for %q is invalid", windowName)
		}
	case panelwindow.NativeRolePanel:
		if descriptor.Panel == nil || descriptor.Panel.WindowName != windowName {
			return applicationMenuCaller{}, fmt.Errorf("panel descriptor for %q is invalid", windowName)
		}
	default:
		return applicationMenuCaller{}, fmt.Errorf("native window %q has unknown role %q", windowName, descriptor.Role)
	}
	return applicationMenuCaller{windowName: windowName, descriptor: descriptor}, nil
}

func (s *DesktopShell) emitApplicationWindowEvent(
	windowName string,
	name string,
	data ...any,
) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("desktop runtime is not available")
	}
	if windowName == "" {
		s.emitCurrentWindowEvent(name, data...)
		return nil
	}
	if s.application == nil {
		// Headless transports use the same fallback emitter as existing native
		// menu tests; a real Wails sender always has an application window.
		s.emitFallback(name, data...)
		return nil
	}
	window, err := s.workspaceWindow(windowName)
	if err != nil {
		return err
	}
	window.EmitEvent(name, data...)
	return nil
}

func (s *DesktopShell) emitOwnerApplicationMenuEvent(
	caller applicationMenuCaller,
	command panelwindow.OwnerCommand,
) error {
	if caller.descriptor.Role == panelwindow.NativeRolePanel {
		return s.RoutePanelWindowCommand(caller.windowName, command)
	}
	return s.emitApplicationWindowEvent(caller.windowName, string(command))
}

func (s *DesktopShell) applicationMenuWindow(windowName string) (application.Window, error) {
	if windowName == "" {
		return s.currentWindowWhenReady()
	}
	return s.workspaceWindowWhenReady(windowName)
}

func (s *DesktopShell) toggleSidebarForCaller(caller applicationMenuCaller) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	if err := s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandToggleSidebar); err != nil {
		return err
	}
	s.sidebarVisible = !s.sidebarVisible
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) toggleAppLogsForCaller(caller applicationMenuCaller) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	if err := s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandToggleAppLogs); err != nil {
		return err
	}
	s.appLogsPanelVisible = !s.appLogsPanelVisible
	if s.logger != nil {
		s.logger.Info("Application Logs Panel toggled", logsources.App)
	}
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) toggleDiagnosticsForCaller(caller applicationMenuCaller) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	if err := s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandToggleDiagnostics); err != nil {
		return err
	}
	s.diagnosticsPanelVisible = !s.diagnosticsPanelVisible
	if s.logger != nil {
		s.logger.Info("Diagnostics panel toggled", logsources.App)
	}
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) showAboutAndCheckForUpdatesForCaller(caller applicationMenuCaller) error {
	if err := s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandOpenAbout); err != nil {
		return err
	}
	s.checkForUpdatesInBackground()
	return nil
}

func (s *DesktopShell) executeProcessApplicationMenuCommand(
	windowName string,
	command ApplicationMenuCommand,
) bool {
	switch command {
	case ApplicationMenuCommandNewWindow:
		s.createWorkspaceWindowFromMenu()
	case ApplicationMenuCommandQuit:
		s.quitApplicationFromMenu()
	case ApplicationMenuCommandHide:
		go s.hideApplicationFromMenu()
	case ApplicationMenuCommandBringAllToFront:
		go s.bringAllWindowsToFront()
	case ApplicationMenuCommandSettings:
		if windowName != "" {
			return false
		}
		s.ShowSettings()
	case ApplicationMenuCommandAbout:
		if windowName != "" {
			return false
		}
		s.ShowAbout()
	case ApplicationMenuCommandCheckForUpdates:
		if windowName != "" {
			return false
		}
		s.showAboutAndCheckForUpdates()
	default:
		return false
	}
	return true
}

func (s *DesktopShell) executeApplicationWindowCommand(
	windowName string,
	command ApplicationMenuCommand,
) error {
	window, err := s.applicationMenuWindow(windowName)
	if err != nil {
		return err
	}
	switch command {
	case ApplicationMenuCommandMinimise:
		window.Minimise()
	case ApplicationMenuCommandMaximise:
		window.Maximise()
	case ApplicationMenuCommandRestore:
		window.Restore()
	case ApplicationMenuCommandToggleMaximise:
		window.ToggleMaximise()
	default:
		return fmt.Errorf("unknown application window command %q", command)
	}
	return nil
}

// ExecuteApplicationMenuCommand routes a typed menu command according to the
// authenticated native caller role.
func (s *DesktopShell) ExecuteApplicationMenuCommand(
	windowName string,
	command ApplicationMenuCommand,
) error {
	// Native menu callbacks omit the sender. Resolve it before the no-window
	// Settings/About paths so a focused panel routes through its workspace owner.
	if windowName == "" {
		if window, err := s.currentWindowWhenReady(); err == nil {
			windowName = window.Name()
		}
	}
	if s.executeProcessApplicationMenuCommand(windowName, command) {
		return nil
	}
	caller, err := s.resolveApplicationMenuCaller(windowName)
	if err != nil {
		return err
	}

	switch command {
	case ApplicationMenuCommandOpenCluster:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandOpenCluster)
	case ApplicationMenuCommandClose:
		return s.emitApplicationWindowEvent(caller.windowName, "menu:close")
	case ApplicationMenuCommandSettings:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandOpenSettings)
	case ApplicationMenuCommandCut:
		return s.emitApplicationWindowEvent(caller.windowName, "menu:cut")
	case ApplicationMenuCommandCopy:
		return s.emitApplicationWindowEvent(caller.windowName, "menu:copy")
	case ApplicationMenuCommandPaste:
		text, err := s.clipboardText()
		if err != nil {
			// Clipboard text can be unavailable (for example, an image-only clipboard).
			return nil
		}
		return s.emitApplicationWindowEvent(caller.windowName, "menu:paste", text)
	case ApplicationMenuCommandSelectAll:
		return s.emitApplicationWindowEvent(caller.windowName, "menu:selectAll")
	case ApplicationMenuCommandCommandPalette:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandOpenCommandPalette)
	case ApplicationMenuCommandZoomIn:
		return s.emitApplicationWindowEvent(caller.windowName, "zoom-in")
	case ApplicationMenuCommandZoomOut:
		return s.emitApplicationWindowEvent(caller.windowName, "zoom-out")
	case ApplicationMenuCommandZoomReset:
		return s.emitApplicationWindowEvent(caller.windowName, "zoom-reset")
	case ApplicationMenuCommandToggleSidebar:
		return s.toggleSidebarForCaller(caller)
	case ApplicationMenuCommandToggleObjectDiff:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandToggleObjectDiff)
	case ApplicationMenuCommandToggleAppLogs:
		return s.toggleAppLogsForCaller(caller)
	case ApplicationMenuCommandToggleDiagnostics:
		return s.toggleDiagnosticsForCaller(caller)
	case ApplicationMenuCommandOpenInspector:
		return s.emitApplicationWindowEvent(caller.windowName, "debug:open-inspector")
	case ApplicationMenuCommandToggleFocusDebug:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandToggleFocusDebug)
	case ApplicationMenuCommandTogglePanelDebug:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandTogglePanelDebug)
	case ApplicationMenuCommandToggleMapDebug:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandToggleMapDebug)
	case ApplicationMenuCommandToggleIconDebug:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandToggleIconDebug)
	case ApplicationMenuCommandToggleErrorDebug:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandToggleErrorDebug)
	case ApplicationMenuCommandMinimise,
		ApplicationMenuCommandMaximise,
		ApplicationMenuCommandRestore,
		ApplicationMenuCommandToggleMaximise:
		return s.executeApplicationWindowCommand(caller.windowName, command)
	case ApplicationMenuCommandAbout:
		return s.emitOwnerApplicationMenuEvent(caller, panelwindow.OwnerCommandOpenAbout)
	case ApplicationMenuCommandCheckForUpdates:
		return s.showAboutAndCheckForUpdatesForCaller(caller)
	default:
		return fmt.Errorf("unknown application menu command %q", command)
	}
}
