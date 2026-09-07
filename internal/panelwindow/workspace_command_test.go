package panelwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWorkspaceCommandValidationCoversTheCompleteCatalog(t *testing.T) {
	commands := []WorkspaceCommand{
		WorkspaceCommandOpenAbout,
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
		WorkspaceCommandTogglePanelDebug,
	}

	for _, command := range commands {
		require.Truef(t, command.Valid(), "expected %q to be a valid owner command", command)
	}
	require.False(t, WorkspaceCommand("delete-object").Valid())
}
