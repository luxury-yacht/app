package panelwindow

// OwnerCommand is a workspace-owned application command that a panel window
// may route to its immutable owner.
type OwnerCommand string

const (
	OwnerCommandOpenAbout          OwnerCommand = "open-about"
	OwnerCommandOpenCluster        OwnerCommand = "open-cluster"
	OwnerCommandOpenCommandPalette OwnerCommand = "open-command-palette"
	OwnerCommandOpenSettings       OwnerCommand = "open-settings"
	OwnerCommandToggleAppLogs      OwnerCommand = "toggle-app-logs-panel"
	OwnerCommandToggleDiagnostics  OwnerCommand = "toggle-diagnostics"
	OwnerCommandToggleObjectDiff   OwnerCommand = "toggle-object-diff"
	OwnerCommandToggleSidebar      OwnerCommand = "toggle-sidebar"
	OwnerCommandToggleErrorDebug   OwnerCommand = "debug:toggle-error-overlay"
	OwnerCommandToggleFocusDebug   OwnerCommand = "debug:toggle-focus-overlay"
	OwnerCommandToggleIconDebug    OwnerCommand = "debug:toggle-icon-overlay"
	OwnerCommandToggleMapDebug     OwnerCommand = "debug:toggle-map-overlay"
	OwnerCommandTogglePanelDebug   OwnerCommand = "debug:toggle-panel-overlay"
)

func (command OwnerCommand) Valid() bool {
	switch command {
	case OwnerCommandOpenAbout,
		OwnerCommandOpenCluster,
		OwnerCommandOpenCommandPalette,
		OwnerCommandOpenSettings,
		OwnerCommandToggleAppLogs,
		OwnerCommandToggleDiagnostics,
		OwnerCommandToggleObjectDiff,
		OwnerCommandToggleSidebar,
		OwnerCommandToggleErrorDebug,
		OwnerCommandToggleFocusDebug,
		OwnerCommandToggleIconDebug,
		OwnerCommandToggleMapDebug,
		OwnerCommandTogglePanelDebug:
		return true
	default:
		return false
	}
}
