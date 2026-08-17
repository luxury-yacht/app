package backend

import (
	"fmt"
	"runtime"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

func (s *DesktopShell) ToggleDiagnosticsPanel() error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}

	s.diagnosticsPanelVisible = !s.diagnosticsPanelVisible
	s.logger.Info("Diagnostics panel toggled", logsources.App)
	s.emitCurrentWindowEvent("toggle-diagnostics")
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) ToggleAppLogsPanel() error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}

	s.appLogsPanelVisible = !s.appLogsPanelVisible
	s.logger.Info("Application Logs Panel toggled", logsources.App)
	s.emitCurrentWindowEvent("toggle-app-logs-panel")
	s.UpdateMenu()
	return nil
}

func (s *DesktopShell) ToggleSidebar() error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}

	s.sidebarVisible = !s.sidebarVisible
	s.emitCurrentWindowEvent("toggle-sidebar")
	s.UpdateMenu()
	return nil
}

// ToggleObjectDiff emits an event that opens or closes the object diff modal.
func (s *DesktopShell) ToggleObjectDiff() error {
	if !s.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}

	s.emitCurrentWindowEvent("toggle-object-diff")
	return nil
}

func (s *DesktopShell) UpdateMenu() {
	if s == nil || !s.runtimeAvailable() || s.menu == nil {
		return
	}
	s.menu.Clear()
	populateMenu(s.menu, s)

	applyNativeMenuRefresh(
		runtime.GOOS,
		func() { s.menu.Update() },
		func() {
			if s.application != nil {
				s.application.Menu.SetApplicationMenu(s.menu)
			}
		},
		func() {
			if s.application != nil {
				for _, window := range s.application.Window.GetAll() {
					window.SetMenu(s.menu)
				}
			}
		},
	)
}

func applyNativeMenuRefresh(goos string, updateMenu, setApplicationMenu, setWindowMenu func()) {
	switch goos {
	case "linux":
		updateMenu()
	case "darwin":
		setApplicationMenu()
	case "windows":
		setWindowMenu()
	}
}

func (s *DesktopShell) IsSidebarVisible() bool {
	return s.sidebarVisible
}

func (s *DesktopShell) IsDiagnosticsPanelVisible() bool {
	return s.diagnosticsPanelVisible
}

func (s *DesktopShell) IsAppLogsPanelVisible() bool {
	return s.appLogsPanelVisible
}

func (s *DesktopShell) SetSidebarVisible(visible bool) {
	if s.sidebarVisible != visible {
		s.sidebarVisible = visible
		s.UpdateMenu()
	}
}

func (s *DesktopShell) SetAppLogsPanelVisible(visible bool) {
	if s.appLogsPanelVisible != visible {
		s.appLogsPanelVisible = visible
		s.UpdateMenu()
	}
}
