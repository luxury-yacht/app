package backend

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// A workspace switch claims the saved clusters before it closes anything, and
// can still be refused after that. What the next launch opens must not change
// until the switch has closed the previous windows.
func TestNamedWorkspaceSeedLeavesTheRestartSelectionUntilTheSwitchCommits(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	w := app.Workspace
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "prod"},
		{Name: "config", Path: "/tmp/config", Context: "stage"},
	}
	current := []string{"/tmp/config:prod"}
	require.NoError(t, app.Preferences.SaveSelectedKubeconfigs(current))
	w.kubeconfigsMu.Lock()
	w.setSelectedKubeconfigsLocked(current)
	w.kubeconfigsMu.Unlock()
	w.GetClusterWorkspaceStateForWindow("current")
	defer func() {
		w.cancelActiveSelectionGeneration()
		require.True(t, w.waitForSelectionMutationIdle(5*time.Second))
	}()

	// "stage" has no owner yet, so the seed goes through the selection mutation.
	require.NoError(t, app.Lifecycle.SeedNamedWorkspaceWindow("restore", []string{"config:prod", "config:stage"}, ""))
	require.ElementsMatch(t, []string{"/tmp/config:prod", "/tmp/config:stage"}, w.GetSelectedKubeconfigs(), "the saved cluster is claimed")
	require.Equal(t, current, app.Preferences.SelectedKubeconfigs(), "an abandoned switch must not change the next launch")

	app.Lifecycle.PersistRestartSelection()
	require.ElementsMatch(t, []string{"/tmp/config:prod", "/tmp/config:stage"}, app.Preferences.SelectedKubeconfigs())

	// A workspace of floating panel windows alone still shows a cluster, and
	// that is what the next launch opens.
	require.NoError(t, w.RetainPanelCluster("panel-1", "config:stage"))
	w.ReleaseWorkspaceWindow("current")
	w.ReleaseWorkspaceWindow("restore")
	require.Equal(t, []string{"/tmp/config:stage"}, w.GetSelectedKubeconfigs())
	app.Lifecycle.PersistRestartSelection()
	require.Equal(t, []string{"/tmp/config:stage"}, app.Preferences.SelectedKubeconfigs())

	// With nothing left open at all, the last selection is kept.
	require.NoError(t, w.ReleasePanelCluster("panel-1"))
	app.Lifecycle.PersistRestartSelection()
	require.Equal(t, []string{"/tmp/config:stage"}, app.Preferences.SelectedKubeconfigs())
}
