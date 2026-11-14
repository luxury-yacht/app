package backend

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// A workspace switch claims the saved clusters before it closes anything, can
// still be refused after that, and then gives up the previous windows one by
// one. What the next launch opens must not pass through any of those states:
// it is written once, when the switch has settled.
func TestNamedWorkspaceSwitchWritesTheRestartSelectionOnce(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	w := app.Workspace
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Name: "config", Path: "/tmp/config", Context: "prod"},
		{Name: "config", Path: "/tmp/config", Context: "stage"},
		{Name: "config", Path: "/tmp/config", Context: "dev"},
	}
	current := []string{"/tmp/config:prod", "/tmp/config:stage"}
	require.NoError(t, app.Preferences.SaveSelectedKubeconfigs(current))
	w.kubeconfigsMu.Lock()
	w.setSelectedKubeconfigsLocked(current)
	w.kubeconfigsMu.Unlock()
	// Two windows, one cluster each.
	require.NoError(t, app.Lifecycle.SeedNamedWorkspaceWindow("first", []string{"config:prod"}, ""))
	require.NoError(t, app.Lifecycle.SeedNamedWorkspaceWindow("second", []string{"config:stage"}, ""))
	defer func() {
		w.cancelActiveSelectionGeneration()
		require.True(t, w.waitForSelectionMutationIdle(5*time.Second))
	}()

	// A switch that is refused after it claimed the saved cluster leaves what
	// the next launch opens as it was.
	app.Lifecycle.HoldRestartSelection()
	require.NoError(t, app.Lifecycle.SeedNamedWorkspaceWindow("refused", []string{"config:dev"}, ""))
	w.ReleaseWorkspaceWindow("refused")
	app.Lifecycle.PersistRestartSelection()
	require.ElementsMatch(t, current, app.Preferences.SelectedKubeconfigs())

	app.Lifecycle.HoldRestartSelection()
	// "dev" has no owner yet, so the seed goes through the selection mutation.
	require.NoError(t, app.Lifecycle.SeedNamedWorkspaceWindow("restore", []string{"config:dev"}, ""))
	require.Len(t, w.GetSelectedKubeconfigs(), 3, "the saved cluster is claimed")
	require.Equal(t, current, app.Preferences.SelectedKubeconfigs(), "an abandoned switch must not change the next launch")
	// Once the new workspace is on screen the user can quit, so its clusters
	// are written then, before the previous windows' are released.
	app.Lifecycle.WriteRestartSelectionOf("restore")
	require.Equal(t, []string{"/tmp/config:dev"}, app.Preferences.SelectedKubeconfigs())
	w.ReleaseWorkspaceWindow("first")
	require.ElementsMatch(t, []string{"/tmp/config:stage", "/tmp/config:dev"}, w.GetSelectedKubeconfigs())
	require.Equal(t, []string{"/tmp/config:dev"}, app.Preferences.SelectedKubeconfigs(), "a half-released workspace is never what the next launch opens")
	w.ReleaseWorkspaceWindow("second")
	require.Equal(t, []string{"/tmp/config:dev"}, app.Preferences.SelectedKubeconfigs())

	app.Lifecycle.PersistRestartSelection()
	require.Equal(t, []string{"/tmp/config:dev"}, app.Preferences.SelectedKubeconfigs())

	// Once the switch is over, a change is written as it happens again.
	require.NoError(t, app.Lifecycle.SeedNamedWorkspaceWindow("later", []string{"config:dev", "config:stage"}, ""))
	require.ElementsMatch(t, []string{"/tmp/config:dev", "/tmp/config:stage"}, app.Preferences.SelectedKubeconfigs())

	// A workspace of floating panel windows alone still shows a cluster, and
	// that is what the next launch opens.
	require.NoError(t, w.RetainPanelCluster("panel-1", "config:stage"))
	w.ReleaseWorkspaceWindow("restore")
	w.ReleaseWorkspaceWindow("later")
	require.Equal(t, []string{"/tmp/config:stage"}, w.GetSelectedKubeconfigs())
	app.Lifecycle.PersistRestartSelection()
	require.Equal(t, []string{"/tmp/config:stage"}, app.Preferences.SelectedKubeconfigs())

	// A workspace whose windows show no cluster is a selection too: the next
	// launch must not reopen the clusters of the workspace before it.
	app.Lifecycle.HoldRestartSelection()
	require.NoError(t, app.Lifecycle.SeedNamedWorkspaceWindow("empty", nil, ""))
	require.NoError(t, w.ReleasePanelCluster("panel-1"))
	require.Empty(t, w.GetSelectedKubeconfigs())
	app.Lifecycle.PersistRestartSelection()
	require.Empty(t, app.Preferences.SelectedKubeconfigs())

	// With nothing left open at all, the last selection is kept.
	require.NoError(t, app.Preferences.SaveSelectedKubeconfigs([]string{"/tmp/config:stage"}))
	w.ReleaseWorkspaceWindow("empty")
	app.Lifecycle.PersistRestartSelection()
	require.Equal(t, []string{"/tmp/config:stage"}, app.Preferences.SelectedKubeconfigs())
}
