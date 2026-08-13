package backend

import (
	"fmt"
	"runtime"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

func (a *App) ToggleDiagnosticsPanel() error {
	if !a.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}

	a.diagnosticsPanelVisible = !a.diagnosticsPanelVisible
	a.logger.Info("Diagnostics panel toggled", logsources.App)
	a.emitCurrentWindowEvent("toggle-diagnostics")
	a.UpdateMenu()
	return nil
}

func (a *App) ToggleAppLogsPanel() error {
	if !a.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}

	a.appLogsPanelVisible = !a.appLogsPanelVisible
	a.logger.Info("Application Logs Panel toggled", logsources.App)
	a.emitCurrentWindowEvent("toggle-app-logs-panel")
	a.UpdateMenu()
	return nil
}

func (a *App) ToggleSidebar() error {
	if !a.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}

	a.sidebarVisible = !a.sidebarVisible
	a.emitCurrentWindowEvent("toggle-sidebar")
	a.UpdateMenu()
	return nil
}

// ToggleObjectDiff emits an event that opens or closes the object diff modal.
func (a *App) ToggleObjectDiff() error {
	if !a.runtimeAvailable() {
		return fmt.Errorf("application context not available")
	}

	a.emitCurrentWindowEvent("toggle-object-diff")
	return nil
}

func (a *App) UpdateMenu() {
	if a == nil || !a.runtimeAvailable() || a.menu == nil {
		return
	}
	a.menu.Clear()
	populateMenu(a.menu, a)

	applyNativeMenuRefresh(
		runtime.GOOS,
		func() { a.menu.Update() },
		func() {
			if a.wailsApplication != nil {
				a.wailsApplication.Menu.SetApplicationMenu(a.menu)
			}
		},
		func() {
			if a.wailsApplication != nil {
				for _, window := range a.wailsApplication.Window.GetAll() {
					window.SetMenu(a.menu)
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

func (a *App) IsSidebarVisible() bool {
	return a.sidebarVisible
}

func (a *App) IsDiagnosticsPanelVisible() bool {
	return a.diagnosticsPanelVisible
}

func (a *App) IsAppLogsPanelVisible() bool {
	return a.appLogsPanelVisible
}

func (a *App) SetSidebarVisible(visible bool) {
	if a.sidebarVisible != visible {
		a.sidebarVisible = visible
		a.UpdateMenu()
	}
}

func (a *App) SetAppLogsPanelVisible(visible bool) {
	if a.appLogsPanelVisible != visible {
		a.appLogsPanelVisible = visible
		a.UpdateMenu()
	}
}
