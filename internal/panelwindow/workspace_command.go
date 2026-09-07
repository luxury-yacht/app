package panelwindow

// WorkspaceCommand is an application command a panel window can route to an
// app window displaying its cluster.
type WorkspaceCommand string

const (
	WorkspaceCommandOpenAbout          WorkspaceCommand = "open-about"
	WorkspaceCommandOpenCluster        WorkspaceCommand = "open-cluster"
	WorkspaceCommandOpenCommandPalette WorkspaceCommand = "open-command-palette"
	WorkspaceCommandOpenSettings       WorkspaceCommand = "open-settings"
	WorkspaceCommandToggleAppLogs      WorkspaceCommand = "toggle-app-logs-panel"
	WorkspaceCommandToggleDiagnostics  WorkspaceCommand = "toggle-diagnostics"
	WorkspaceCommandToggleObjectDiff   WorkspaceCommand = "toggle-object-diff"
	WorkspaceCommandToggleSidebar      WorkspaceCommand = "toggle-sidebar"
	WorkspaceCommandToggleErrorDebug   WorkspaceCommand = "debug:toggle-error-overlay"
	WorkspaceCommandToggleFocusDebug   WorkspaceCommand = "debug:toggle-focus-overlay"
	WorkspaceCommandToggleIconDebug    WorkspaceCommand = "debug:toggle-icon-overlay"
	WorkspaceCommandToggleMapDebug     WorkspaceCommand = "debug:toggle-map-overlay"
	WorkspaceCommandTogglePanelDebug   WorkspaceCommand = "debug:toggle-panel-overlay"
)

func (command WorkspaceCommand) Valid() bool {
	switch command {
	case WorkspaceCommandOpenAbout,
		WorkspaceCommandOpenCluster,
		WorkspaceCommandOpenCommandPalette,
		WorkspaceCommandOpenSettings,
		WorkspaceCommandToggleAppLogs,
		WorkspaceCommandToggleDiagnostics,
		WorkspaceCommandToggleObjectDiff,
		WorkspaceCommandToggleSidebar,
		WorkspaceCommandToggleErrorDebug,
		WorkspaceCommandToggleFocusDebug,
		WorkspaceCommandToggleIconDebug,
		WorkspaceCommandToggleMapDebug,
		WorkspaceCommandTogglePanelDebug:
		return true
	default:
		return false
	}
}
