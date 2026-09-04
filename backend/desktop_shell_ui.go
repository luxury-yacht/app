package backend

import "runtime"

func (s *DesktopShell) UpdateMenu() {
	if s == nil || !s.runtimeAvailable() || s.menu == nil {
		return
	}
	s.menu.Clear()
	populateMenu(s.menu, s)

	applyNativeMenuRefresh(
		runtime.GOOS,
		func() {
			if s.application != nil {
				s.application.Menu.SetApplicationMenu(s.menu)
			}
		},
	)
}

func applyNativeMenuRefresh(goos string, setApplicationMenu func()) {
	switch goos {
	case "darwin":
		setApplicationMenu()
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
