package backend

import (
	"fmt"
	"runtime"
)

func (a *App) ToggleDiagnosticsPanel() error {
	if a.Ctx == nil {
		return fmt.Errorf("application context not available")
	}

	a.diagnosticsPanelVisible = !a.diagnosticsPanelVisible
	a.logger.Info("Diagnostics panel toggled", "App")
	a.emitEvent("toggle-diagnostics")
	a.UpdateMenu()
	return nil
}

func (a *App) ToggleLogsPanel() error {
	if a.Ctx == nil {
		return fmt.Errorf("application context not available")
	}

	a.logsPanelVisible = !a.logsPanelVisible
	a.logger.Info("Logs panel toggled", "App")
	a.emitEvent("toggle-app-logs")
	a.UpdateMenu()
	return nil
}

func (a *App) ToggleSidebar() error {
	if a.Ctx == nil {
		return fmt.Errorf("application context not available")
	}

	a.sidebarVisible = !a.sidebarVisible
	a.emitEvent("toggle-sidebar")
	a.UpdateMenu()
	return nil
}

// ToggleObjectDiff emits an event that opens or closes the object diff modal.
func (a *App) ToggleObjectDiff() error {
	if a.Ctx == nil {
		return fmt.Errorf("application context not available")
	}

	a.emitEvent("toggle-object-diff")
	return nil
}

func (a *App) UpdateMenu() {
	if a.Ctx == nil {
		return
	}
	// On Linux, refreshing the menu rebuilds the GTK menubar without reattaching it,
	// which invalidates the click callbacks and causes a nil dereference in Wails.
	// Skip dynamic menu updates there to keep menu callbacks stable.
	if runtime.GOOS == "linux" {
		return
	}
	a.emitEvent("update-menu")
}

func (a *App) IsSidebarVisible() bool {
	return a.sidebarVisible
}

func (a *App) IsDiagnosticsPanelVisible() bool {
	return a.diagnosticsPanelVisible
}

func (a *App) IsLogsPanelVisible() bool {
	return a.logsPanelVisible
}

func (a *App) SetSidebarVisible(visible bool) {
	if a.sidebarVisible != visible {
		a.sidebarVisible = visible
		a.UpdateMenu()
	}
}

func (a *App) SetLogsPanelVisible(visible bool) {
	if a.logsPanelVisible != visible {
		a.logsPanelVisible = visible
		a.UpdateMenu()
	}
}
