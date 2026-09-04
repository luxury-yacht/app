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
		// Native menu callbacks do not carry a service context. Resolve the
		// focused Wails window when one exists; headless tests retain the existing
		// fallback event path.
		if s == nil || s.application == nil || s.nativeWindowDescriptor == nil {
			return applicationMenuCaller{}, nil
		}
		window, err := s.currentWindowWhenReady()
		if err != nil {
			return applicationMenuCaller{}, err
		}
		windowName = window.Name()
	}
	if s == nil || s.nativeWindowDescriptor == nil {
		return applicationMenuCaller{}, fmt.Errorf("native-window registry is not available")
	}
	descriptor, err := s.nativeWindowDescriptor(windowName)
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
		if descriptor.Panel.State != panelwindow.WindowStateLive {
			return applicationMenuCaller{}, fmt.Errorf("panel window %q is not ready", windowName)
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

func (s *DesktopShell) emitApplicationMenuEvent(
	caller applicationMenuCaller,
	ownerRouted bool,
	name string,
	data ...any,
) error {
	if ownerRouted && caller.descriptor.Role == panelwindow.NativeRolePanel {
		return s.RoutePanelWindowCommand(caller.windowName, name)
	}
	return s.emitApplicationWindowEvent(caller.windowName, name, data...)
}

func (s *DesktopShell) applicationMenuWindow(windowName string) (application.Window, error) {
	if windowName == "" {
		return s.currentWindowWhenReady()
	}
	return s.workspaceWindowWhenReady(windowName)
}

func (s *DesktopShell) toggleSidebarForWindow(windowName string) error {
	return s.toggleSidebarForCaller(applicationMenuCaller{windowName: windowName})
}

func (s *DesktopShell) toggleSidebarForCaller(caller applicationMenuCaller) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	if err := s.emitApplicationMenuEvent(caller, true, "toggle-sidebar"); err != nil {
		return err
	}
	s.sidebarVisible = !s.sidebarVisible
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) toggleObjectDiffForWindow(windowName string) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	return s.emitApplicationWindowEvent(windowName, "toggle-object-diff")
}

func (s *DesktopShell) toggleAppLogsForWindow(windowName string) error {
	return s.toggleAppLogsForCaller(applicationMenuCaller{windowName: windowName})
}

func (s *DesktopShell) toggleAppLogsForCaller(caller applicationMenuCaller) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	if err := s.emitApplicationMenuEvent(caller, true, "toggle-app-logs-panel"); err != nil {
		return err
	}
	s.appLogsPanelVisible = !s.appLogsPanelVisible
	if s.logger != nil {
		s.logger.Info("Application Logs Panel toggled", logsources.App)
	}
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) toggleDiagnosticsForWindow(windowName string) error {
	return s.toggleDiagnosticsForCaller(applicationMenuCaller{windowName: windowName})
}

func (s *DesktopShell) toggleDiagnosticsForCaller(caller applicationMenuCaller) error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}
	if err := s.emitApplicationMenuEvent(caller, true, "toggle-diagnostics"); err != nil {
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
	if caller.windowName == "" {
		s.showAboutAndCheckForUpdates()
		return nil
	}
	if err := s.emitApplicationMenuEvent(caller, true, "open-about"); err != nil {
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
	caller, err := s.resolveApplicationMenuCaller(windowName)
	if err != nil {
		return err
	}

	switch command {
	case ApplicationMenuCommandNewWindow:
		s.createWorkspaceWindowFromMenu()
		return nil
	case ApplicationMenuCommandOpenCluster:
		return s.emitApplicationMenuEvent(caller, true, "open-cluster")
	case ApplicationMenuCommandClose:
		return s.emitApplicationMenuEvent(caller, false, "menu:close")
	case ApplicationMenuCommandSettings:
		if caller.windowName == "" {
			s.ShowSettings()
			return nil
		}
		return s.emitApplicationMenuEvent(caller, true, "open-settings")
	case ApplicationMenuCommandQuit:
		s.quitApplicationFromMenu()
		return nil
	case ApplicationMenuCommandHide:
		go s.hideApplicationFromMenu()
		return nil
	case ApplicationMenuCommandCut:
		return s.emitApplicationMenuEvent(caller, false, "menu:cut")
	case ApplicationMenuCommandCopy:
		return s.emitApplicationMenuEvent(caller, false, "menu:copy")
	case ApplicationMenuCommandPaste:
		text, err := s.clipboardText()
		if err != nil {
			return err
		}
		return s.emitApplicationMenuEvent(caller, false, "menu:paste", text)
	case ApplicationMenuCommandSelectAll:
		return s.emitApplicationMenuEvent(caller, false, "menu:selectAll")
	case ApplicationMenuCommandCommandPalette:
		return s.emitApplicationMenuEvent(caller, true, "open-command-palette")
	case ApplicationMenuCommandZoomIn:
		return s.emitApplicationMenuEvent(caller, false, "zoom-in")
	case ApplicationMenuCommandZoomOut:
		return s.emitApplicationMenuEvent(caller, false, "zoom-out")
	case ApplicationMenuCommandZoomReset:
		return s.emitApplicationMenuEvent(caller, false, "zoom-reset")
	case ApplicationMenuCommandToggleSidebar:
		return s.toggleSidebarForCaller(caller)
	case ApplicationMenuCommandToggleObjectDiff:
		return s.emitApplicationMenuEvent(caller, true, "toggle-object-diff")
	case ApplicationMenuCommandToggleAppLogs:
		return s.toggleAppLogsForCaller(caller)
	case ApplicationMenuCommandToggleDiagnostics:
		return s.toggleDiagnosticsForCaller(caller)
	case ApplicationMenuCommandOpenInspector:
		return s.emitApplicationMenuEvent(caller, false, "debug:open-inspector")
	case ApplicationMenuCommandToggleFocusDebug:
		return s.emitApplicationMenuEvent(caller, true, "debug:toggle-focus-overlay")
	case ApplicationMenuCommandTogglePanelDebug:
		return s.emitApplicationMenuEvent(caller, true, "debug:toggle-panel-overlay")
	case ApplicationMenuCommandToggleMapDebug:
		return s.emitApplicationMenuEvent(caller, true, "debug:toggle-map-overlay")
	case ApplicationMenuCommandToggleIconDebug:
		return s.emitApplicationMenuEvent(caller, true, "debug:toggle-icon-overlay")
	case ApplicationMenuCommandToggleErrorDebug:
		return s.emitApplicationMenuEvent(caller, true, "debug:toggle-error-overlay")
	case ApplicationMenuCommandMinimise,
		ApplicationMenuCommandMaximise,
		ApplicationMenuCommandRestore,
		ApplicationMenuCommandToggleMaximise:
		return s.executeApplicationWindowCommand(caller.windowName, command)
	case ApplicationMenuCommandBringAllToFront:
		go s.bringAllWindowsToFront()
		return nil
	case ApplicationMenuCommandAbout:
		if caller.windowName == "" {
			s.ShowAbout()
			return nil
		}
		return s.emitApplicationMenuEvent(caller, true, "open-about")
	case ApplicationMenuCommandCheckForUpdates:
		return s.showAboutAndCheckForUpdatesForCaller(caller)
	default:
		return fmt.Errorf("unknown application menu command %q", command)
	}
}
