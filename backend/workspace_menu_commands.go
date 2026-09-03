package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// WorkspaceMenuCommand is the shared command identity used by both the native
// macOS menu and the app-rendered Windows/Linux menu bar.
type WorkspaceMenuCommand string

const (
	WorkspaceMenuCommandNewWindow         WorkspaceMenuCommand = "new-window"
	WorkspaceMenuCommandOpenCluster       WorkspaceMenuCommand = "open-cluster"
	WorkspaceMenuCommandClose             WorkspaceMenuCommand = "close"
	WorkspaceMenuCommandSettings          WorkspaceMenuCommand = "settings"
	WorkspaceMenuCommandQuit              WorkspaceMenuCommand = "quit"
	WorkspaceMenuCommandHide              WorkspaceMenuCommand = "hide"
	WorkspaceMenuCommandCut               WorkspaceMenuCommand = "cut"
	WorkspaceMenuCommandCopy              WorkspaceMenuCommand = "copy"
	WorkspaceMenuCommandPaste             WorkspaceMenuCommand = "paste"
	WorkspaceMenuCommandSelectAll         WorkspaceMenuCommand = "select-all"
	WorkspaceMenuCommandCommandPalette    WorkspaceMenuCommand = "command-palette"
	WorkspaceMenuCommandZoomIn            WorkspaceMenuCommand = "zoom-in"
	WorkspaceMenuCommandZoomOut           WorkspaceMenuCommand = "zoom-out"
	WorkspaceMenuCommandZoomReset         WorkspaceMenuCommand = "zoom-reset"
	WorkspaceMenuCommandToggleSidebar     WorkspaceMenuCommand = "toggle-sidebar"
	WorkspaceMenuCommandToggleObjectDiff  WorkspaceMenuCommand = "toggle-object-diff"
	WorkspaceMenuCommandToggleAppLogs     WorkspaceMenuCommand = "toggle-app-logs"
	WorkspaceMenuCommandToggleDiagnostics WorkspaceMenuCommand = "toggle-diagnostics"
	WorkspaceMenuCommandOpenInspector     WorkspaceMenuCommand = "open-inspector"
	WorkspaceMenuCommandToggleFocusDebug  WorkspaceMenuCommand = "toggle-focus-debug"
	WorkspaceMenuCommandTogglePanelDebug  WorkspaceMenuCommand = "toggle-panel-debug"
	WorkspaceMenuCommandToggleMapDebug    WorkspaceMenuCommand = "toggle-map-debug"
	WorkspaceMenuCommandToggleIconDebug   WorkspaceMenuCommand = "toggle-icon-debug"
	WorkspaceMenuCommandToggleErrorDebug  WorkspaceMenuCommand = "toggle-error-debug"
	WorkspaceMenuCommandMinimise          WorkspaceMenuCommand = "minimise"
	WorkspaceMenuCommandMaximise          WorkspaceMenuCommand = "maximise"
	WorkspaceMenuCommandRestore           WorkspaceMenuCommand = "restore"
	WorkspaceMenuCommandToggleMaximise    WorkspaceMenuCommand = "toggle-maximise"
	WorkspaceMenuCommandBringAllToFront   WorkspaceMenuCommand = "bring-all-to-front"
	WorkspaceMenuCommandAbout             WorkspaceMenuCommand = "about"
	WorkspaceMenuCommandCheckForUpdates   WorkspaceMenuCommand = "check-for-updates"
)

func (s *DesktopShell) validateWorkspaceMenuCaller(windowName string) error {
	if windowName == "" {
		// Native application-menu callbacks are trusted and resolve the focused
		// native window inside Wails.
		return nil
	}
	if s == nil || s.isWorkspaceWindow == nil || !s.isWorkspaceWindow(windowName) {
		return fmt.Errorf("window %q is not a workspace", windowName)
	}
	return nil
}

func (s *DesktopShell) emitWorkspaceMenuEvent(
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

func (s *DesktopShell) workspaceMenuWindow(windowName string) (application.Window, error) {
	if windowName == "" {
		return s.currentWindowWhenReady()
	}
	return s.workspaceWindowWhenReady(windowName)
}

func (s *DesktopShell) toggleSidebarForWindow(windowName string) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	s.sidebarVisible = !s.sidebarVisible
	if err := s.emitWorkspaceMenuEvent(windowName, "toggle-sidebar"); err != nil {
		return err
	}
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) toggleObjectDiffForWindow(windowName string) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	return s.emitWorkspaceMenuEvent(windowName, "toggle-object-diff")
}

func (s *DesktopShell) toggleAppLogsForWindow(windowName string) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	s.appLogsPanelVisible = !s.appLogsPanelVisible
	if s.logger != nil {
		s.logger.Info("Application Logs Panel toggled", logsources.App)
	}
	if err := s.emitWorkspaceMenuEvent(windowName, "toggle-app-logs-panel"); err != nil {
		return err
	}
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) toggleDiagnosticsForWindow(windowName string) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	s.diagnosticsPanelVisible = !s.diagnosticsPanelVisible
	if s.logger != nil {
		s.logger.Info("Diagnostics panel toggled", logsources.App)
	}
	if err := s.emitWorkspaceMenuEvent(windowName, "toggle-diagnostics"); err != nil {
		return err
	}
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) showAboutAndCheckForUpdatesForWindow(windowName string) error {
	if windowName == "" {
		s.showAboutAndCheckForUpdates()
		return nil
	}
	if err := s.emitWorkspaceMenuEvent(windowName, "open-about"); err != nil {
		return err
	}
	if s.checkForUpdates != nil {
		go func() {
			if err := s.checkForUpdates(); err != nil && s.logger != nil {
				s.logger.Warn(fmt.Sprintf("Application update check failed: %v", err), logsources.App)
			}
		}()
	}
	return nil
}

func (s *DesktopShell) executeWorkspaceWindowCommand(
	windowName string,
	command WorkspaceMenuCommand,
) error {
	window, err := s.workspaceMenuWindow(windowName)
	if err != nil {
		return err
	}
	switch command {
	case WorkspaceMenuCommandMinimise:
		window.Minimise()
	case WorkspaceMenuCommandMaximise:
		window.Maximise()
	case WorkspaceMenuCommandRestore:
		window.Restore()
	case WorkspaceMenuCommandToggleMaximise:
		window.ToggleMaximise()
	default:
		return fmt.Errorf("unknown workspace window command %q", command)
	}
	return nil
}

// ExecuteWorkspaceMenuCommand routes a typed menu command to the same owner
// regardless of whether it came from the native or app-rendered menu.
func (s *DesktopShell) ExecuteWorkspaceMenuCommand(
	windowName string,
	command WorkspaceMenuCommand,
) error {
	if err := s.validateWorkspaceMenuCaller(windowName); err != nil {
		return err
	}

	switch command {
	case WorkspaceMenuCommandNewWindow:
		s.createWorkspaceWindowFromMenu()
		return nil
	case WorkspaceMenuCommandOpenCluster:
		return s.emitWorkspaceMenuEvent(windowName, "open-cluster")
	case WorkspaceMenuCommandClose:
		return s.emitWorkspaceMenuEvent(windowName, "menu:close")
	case WorkspaceMenuCommandSettings:
		if windowName == "" {
			s.ShowSettings()
			return nil
		}
		return s.emitWorkspaceMenuEvent(windowName, "open-settings")
	case WorkspaceMenuCommandQuit:
		s.quitApplicationFromMenu()
		return nil
	case WorkspaceMenuCommandHide:
		go s.hideApplicationFromMenu()
		return nil
	case WorkspaceMenuCommandCut:
		return s.emitWorkspaceMenuEvent(windowName, "menu:cut")
	case WorkspaceMenuCommandCopy:
		return s.emitWorkspaceMenuEvent(windowName, "menu:copy")
	case WorkspaceMenuCommandPaste:
		text, err := s.clipboardText()
		if err != nil {
			return err
		}
		return s.emitWorkspaceMenuEvent(windowName, "menu:paste", text)
	case WorkspaceMenuCommandSelectAll:
		return s.emitWorkspaceMenuEvent(windowName, "menu:selectAll")
	case WorkspaceMenuCommandCommandPalette:
		return s.emitWorkspaceMenuEvent(windowName, "open-command-palette")
	case WorkspaceMenuCommandZoomIn:
		return s.emitWorkspaceMenuEvent(windowName, "zoom-in")
	case WorkspaceMenuCommandZoomOut:
		return s.emitWorkspaceMenuEvent(windowName, "zoom-out")
	case WorkspaceMenuCommandZoomReset:
		return s.emitWorkspaceMenuEvent(windowName, "zoom-reset")
	case WorkspaceMenuCommandToggleSidebar:
		return s.toggleSidebarForWindow(windowName)
	case WorkspaceMenuCommandToggleObjectDiff:
		return s.toggleObjectDiffForWindow(windowName)
	case WorkspaceMenuCommandToggleAppLogs:
		return s.toggleAppLogsForWindow(windowName)
	case WorkspaceMenuCommandToggleDiagnostics:
		return s.toggleDiagnosticsForWindow(windowName)
	case WorkspaceMenuCommandOpenInspector:
		return s.emitWorkspaceMenuEvent(windowName, "debug:open-inspector")
	case WorkspaceMenuCommandToggleFocusDebug:
		return s.emitWorkspaceMenuEvent(windowName, "debug:toggle-focus-overlay")
	case WorkspaceMenuCommandTogglePanelDebug:
		return s.emitWorkspaceMenuEvent(windowName, "debug:toggle-panel-overlay")
	case WorkspaceMenuCommandToggleMapDebug:
		return s.emitWorkspaceMenuEvent(windowName, "debug:toggle-map-overlay")
	case WorkspaceMenuCommandToggleIconDebug:
		return s.emitWorkspaceMenuEvent(windowName, "debug:toggle-icon-overlay")
	case WorkspaceMenuCommandToggleErrorDebug:
		return s.emitWorkspaceMenuEvent(windowName, "debug:toggle-error-overlay")
	case WorkspaceMenuCommandMinimise,
		WorkspaceMenuCommandMaximise,
		WorkspaceMenuCommandRestore,
		WorkspaceMenuCommandToggleMaximise:
		return s.executeWorkspaceWindowCommand(windowName, command)
	case WorkspaceMenuCommandBringAllToFront:
		go s.bringAllWindowsToFront()
		return nil
	case WorkspaceMenuCommandAbout:
		if windowName == "" {
			s.ShowAbout()
			return nil
		}
		return s.emitWorkspaceMenuEvent(windowName, "open-about")
	case WorkspaceMenuCommandCheckForUpdates:
		return s.showAboutAndCheckForUpdatesForWindow(windowName)
	default:
		return fmt.Errorf("unknown workspace menu command %q", command)
	}
}
