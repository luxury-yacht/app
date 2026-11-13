package backend

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Staging a workspace switch admits its clusters so the new windows can mount,
// but the switch can still be abandoned. What the next launch opens must not
// change until the switch has committed.
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
	require.ElementsMatch(t, []string{"/tmp/config:prod", "/tmp/config:stage"}, w.GetSelectedKubeconfigs(), "the staged cluster is admitted")
	require.Equal(t, current, app.Preferences.SelectedKubeconfigs(), "an abandoned switch must not change the next launch")

	app.Lifecycle.PersistRestartSelection()
	require.ElementsMatch(t, []string{"/tmp/config:prod", "/tmp/config:stage"}, app.Preferences.SelectedKubeconfigs())

	// Closing the last window keeps the restart selection, and so does this.
	w.ReleaseWorkspaceWindow("current")
	w.ReleaseWorkspaceWindow("restore")
	app.Lifecycle.PersistRestartSelection()
	require.NotEmpty(t, app.Preferences.SelectedKubeconfigs())
}
