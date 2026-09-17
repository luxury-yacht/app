package backend

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestInitializeSelectedClustersAtStartupUsesSelectionMutationCoordinator(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	app := newWorkspaceCoordinatorTestFixture(t)
	app.AppLogs = NewAppLogService(NewLogger(10))
	selection := "/tmp/config:cluster-a"
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    "/tmp/config",
		Context: "cluster-a",
	}}
	settings := defaultSettingsFile()
	settings.Kubeconfig.Selected = []string{selection}
	require.NoError(t, app.Preferences.saveSettingsFile(settings))

	initializerCalled := make(chan struct{})
	app.Workspace.kubeClientInitializer = func(context.Context) error {
		close(initializerCalled)
		return nil
	}

	app.Workspace.selectionMutationMu.Lock()
	type startupResult struct {
		selectedCount int
		connectionCtx context.Context
		err           error
	}
	result := make(chan startupResult, 1)
	go func() {
		selectedCount, connectionCtx, err := app.Workspace.initializeSelectedClustersAtStartup()
		result <- startupResult{selectedCount: selectedCount, connectionCtx: connectionCtx, err: err}
	}()

	select {
	case <-initializerCalled:
		t.Fatal("startup initialization bypassed the selection mutation coordinator")
	case <-time.After(50 * time.Millisecond):
	}
	require.Empty(t, app.Workspace.GetSelectedKubeconfigs(), "startup restore must share the selection mutation coordinator")

	app.Workspace.selectionMutationMu.Unlock()
	startup := <-result
	require.NoError(t, startup.err)
	require.Equal(t, 1, startup.selectedCount)
	require.Equal(t, []string{selection}, app.Workspace.GetSelectedKubeconfigs())

	require.NoError(t, app.Workspace.connectSelectedClustersAtStartup(startup.connectionCtx))
	require.Eventually(t, func() bool {
		select {
		case <-initializerCalled:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
}

func TestStartupClusterConnectionDoesNotBlockWorkspaceSelectionMutation(t *testing.T) {
	setTestConfigEnv(t)
	app := newWorkspaceCoordinatorTestFixture(t)
	selection := "/tmp/config:cluster-a"
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{{
		Name:    "config",
		Path:    "/tmp/config",
		Context: "cluster-a",
	}}
	settings := defaultSettingsFile()
	settings.Kubeconfig.Selected = []string{selection}
	require.NoError(t, app.Preferences.saveSettingsFile(settings))
	selectedCount, startupContext, err := app.Workspace.initializeSelectedClustersAtStartup()
	require.NoError(t, err)
	require.Equal(t, 1, selectedCount)
	app.Workspace.GetClusterWorkspaceStateForWindow("workspace-1")

	connectionStarted := make(chan struct{})
	releaseConnection := make(chan struct{})
	app.Workspace.kubeClientInitializer = func(ctx context.Context) error {
		close(connectionStarted)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-releaseConnection:
			return nil
		}
	}
	connectionResult := make(chan error, 1)
	startupGeneration := app.Workspace.selectionGeneration.Load()
	go func() {
		connectionResult <- app.Workspace.connectSelectedClustersAtStartup(startupContext)
	}()
	<-connectionStarted

	selectionResult := make(chan ClusterWorkspaceResult, 1)
	go func() {
		selectionResult <- app.Workspace.ApplyClusterWorkspace(ClusterWorkspaceCommand{
			WindowID:                  "workspace-1",
			UpdateSelectedKubeconfigs: true,
		})
	}()

	select {
	case result := <-selectionResult:
		require.Empty(t, result.Error)
	case <-time.After(50 * time.Millisecond):
		close(releaseConnection)
		<-connectionResult
		<-selectionResult
		t.Fatal("workspace selection mutation was blocked by startup cluster connection work")
	}
	require.ErrorIs(t, <-connectionResult, context.Canceled)
	require.Greater(t, app.Workspace.selectionGeneration.Load(), startupGeneration)
}

func TestStartupClusterConnectionSkipsWithoutSelections(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	require.NoError(t, app.Workspace.connectSelectedClustersAtStartup(context.Background()))
}

// TestStartupClusterConnectionFailsWithInvalidSelection verifies that a malformed
// kubeconfig selection string causes an error during normalization/validation.
func TestStartupClusterConnectionFailsWithInvalidSelection(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	setTestAppRuntimeReady(t, app.Lifecycle, context.Background())

	// A selection string that doesn't resolve to a valid kubeconfig path.
	app.Workspace.selectedKubeconfigs = []string{"/nonexistent/path:context"}

	err := app.Workspace.connectSelectedClustersAtStartup(context.Background())
	require.Error(t, err, "startup connection should fail with invalid kubeconfig path")
}

func TestWorkspaceSelectionResolutionPreservesRestoreAndCommandPolicies(t *testing.T) {
	app := newWorkspaceCoordinatorTestFixture(t)
	app.ClusterRuntime.availableKubeconfigs = []KubeconfigInfo{
		{Path: "/tmp/alpha", Context: "dev"},
		{Path: "/tmp/beta", Context: "dev"},
	}
	app.Preferences.appSettings = getDefaultAppSettings()
	app.Preferences.appSettings.SelectedKubeconfigs = []string{
		"/tmp/alpha", "", "/tmp/missing:dev", "/tmp/beta:missing", "/tmp/beta:dev", "/tmp/alpha:dev",
	}

	app.Workspace.restoreKubeconfigSelection()
	want := []string{"/tmp/alpha:dev", "/tmp/beta:dev", "/tmp/alpha:dev"}
	require.Equal(t, want, app.Workspace.GetSelectedKubeconfigs())
	require.Equal(t, want, app.Preferences.SelectedKubeconfigs())
	resolved, err := app.Workspace.selectedKubeconfigSelections()
	require.NoError(t, err)
	require.Len(t, resolved, 3)
	require.Equal(t, "dev", resolved[0].Context)
	require.Equal(t, "/tmp/beta", resolved[1].Path)

	// Restore tolerates unavailable entries and preserves its saved sequence;
	// an explicit command rejects invalid or duplicate selections as a whole.
	for _, invalid := range [][]string{{""}, {"/tmp/missing"}, {"/tmp/beta:missing"}, {"/tmp/alpha", "/tmp/alpha:dev"}} {
		_, err := app.Workspace.buildSelectionChangeIntent(invalid, 1)
		require.Error(t, err)
		require.Equal(t, want, app.Workspace.GetSelectedKubeconfigs())
	}
	intent, err := app.Workspace.buildSelectionChangeIntent([]string{"/tmp/alpha", "/tmp/beta:dev"}, 1)
	require.NoError(t, err)
	require.Equal(t, want[:2], intent.normalizedSelectionText)
}
