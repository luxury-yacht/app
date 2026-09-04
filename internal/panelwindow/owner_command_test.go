package panelwindow

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOwnerCommandValidationCoversTheCompleteCatalog(t *testing.T) {
	commands := []OwnerCommand{
		OwnerCommandOpenAbout,
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
		OwnerCommandTogglePanelDebug,
	}

	for _, command := range commands {
		require.Truef(t, command.Valid(), "expected %q to be a valid owner command", command)
	}
	require.False(t, OwnerCommand("delete-object").Valid())
}
