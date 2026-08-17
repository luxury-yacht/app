package backend

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewApplicationRuntimeHasNoProcessGlobalSideEffects(t *testing.T) {
	stderr := os.Stderr
	t.Setenv("PATH", "/usr/bin")
	homeDirectory := t.TempDir()
	t.Setenv("HOME", homeDirectory)
	require.NoError(t, os.MkdirAll(filepath.Join(homeDirectory, ".local", "bin"), 0o755))

	_ = NewApplicationRuntime(nil)

	require.Same(t, stderr, os.Stderr, "composition must not install process-global stderr capture")
	require.Equal(t, "/usr/bin", os.Getenv("PATH"), "composition must not mutate the process environment")
}

func TestNewApplicationRuntimeSharesOneNodeMaintenanceStore(t *testing.T) {
	runtime := NewApplicationRuntime(nil)
	store := runtime.NodeMaintenance

	require.NotNil(t, store)
	require.Same(t, store, runtime.Resources.nodeMaintenanceStore)
	require.Same(t, store, runtime.Refresh.nodeMaintenanceStore)
	require.Same(t, store, runtime.Operations.drainStore)
}

func TestApplicationCompositionCannotInstallErrorCapture(t *testing.T) {
	source, err := os.ReadFile("app.go")
	require.NoError(t, err)
	require.NotContains(t, string(source), "errorcapture.")
	require.NotContains(t, string(source), "os.Stderr")
}

func TestOwnerConstructorsRejectIncompleteDependencyGraphs(t *testing.T) {
	fixture := newWorkspaceCoordinatorTestFixture(t)

	refreshDependencies := func() RefreshCoordinatorDependencies {
		return RefreshCoordinatorDependencies{
			ClusterRuntime: fixture.ClusterRuntime, ClusterWorkspace: fixture.ClusterWorkspace,
			Attention: fixture.Attention, Logger: fixture.AppLogs.Logger(),
			AllowedNamespaces: func(clusterID string) []string {
				namespaces, _ := fixture.Preferences.clusterAllowedNamespaces(clusterID)
				return namespaces
			},
			Preferences: fixture.Preferences, ContainerLogsPolicy: fixture.ContainerLogsPolicy,
			PermissionFetchPolicy: fixture.PermissionFetchPolicy, Resources: fixture.Resources,
			Context: fixture.Lifecycle.CtxOrBackground, RuntimeAvailable: fixture.Lifecycle.runtimeAvailable,
			EmitEvent: fixture.Lifecycle.emitEvent, ResourceProjection: newRefreshResourceProjection(),
			NodeMaintenanceStore: fixture.NodeMaintenanceStore,
			SettingsBridge:       newRefreshSettingBridge(defaultObjPanelLogsTargetGlobalLimit, defaultMetricsIntervalMs()),
		}
	}
	refreshCases := []struct {
		name   string
		remove func(*RefreshCoordinatorDependencies)
	}{
		{"ClusterRuntime", func(deps *RefreshCoordinatorDependencies) { deps.ClusterRuntime = nil }},
		{"ClusterWorkspace", func(deps *RefreshCoordinatorDependencies) { deps.ClusterWorkspace = nil }},
		{"Attention", func(deps *RefreshCoordinatorDependencies) { deps.Attention = nil }},
		{"Logger", func(deps *RefreshCoordinatorDependencies) { deps.Logger = nil }},
		{"AllowedNamespaces", func(deps *RefreshCoordinatorDependencies) { deps.AllowedNamespaces = nil }},
		{"Preferences", func(deps *RefreshCoordinatorDependencies) { deps.Preferences = nil }},
		{"ContainerLogsPolicy", func(deps *RefreshCoordinatorDependencies) { deps.ContainerLogsPolicy = nil }},
		{"PermissionFetchPolicy", func(deps *RefreshCoordinatorDependencies) { deps.PermissionFetchPolicy = nil }},
		{"Resources", func(deps *RefreshCoordinatorDependencies) { deps.Resources = nil }},
		{"Context", func(deps *RefreshCoordinatorDependencies) { deps.Context = nil }},
		{"RuntimeAvailable", func(deps *RefreshCoordinatorDependencies) { deps.RuntimeAvailable = nil }},
		{"EmitEvent", func(deps *RefreshCoordinatorDependencies) { deps.EmitEvent = nil }},
		{"ResourceProjection", func(deps *RefreshCoordinatorDependencies) { deps.ResourceProjection = nil }},
		{"NodeMaintenanceStore", func(deps *RefreshCoordinatorDependencies) { deps.NodeMaintenanceStore = nil }},
		{"SettingsBridge", func(deps *RefreshCoordinatorDependencies) { deps.SettingsBridge = nil }},
	}
	for _, testCase := range refreshCases {
		t.Run("Refresh/"+testCase.name, func(t *testing.T) {
			dependencies := refreshDependencies()
			testCase.remove(&dependencies)
			require.Panics(t, func() { newRefreshCoordinator(dependencies) })
		})
	}
	require.NotPanics(t, func() { newRefreshCoordinator(refreshDependencies()) })

	workspaceDependencies := func() WorkspaceCoordinatorDependencies {
		return WorkspaceCoordinatorDependencies{
			ClusterRuntime: fixture.ClusterRuntime, ClusterWorkspace: fixture.ClusterWorkspace,
			Refresh: fixture.Refresh, Preferences: fixture.Preferences,
			Operations: fixture.Operations, Logger: fixture.AppLogs.Logger(),
			Context: fixture.Lifecycle.CtxOrBackground, RuntimeAvailable: fixture.Lifecycle.runtimeAvailable,
			EmitEvent: fixture.Lifecycle.emitEvent,
		}
	}
	workspaceCases := []struct {
		name   string
		remove func(*WorkspaceCoordinatorDependencies)
	}{
		{"ClusterRuntime", func(deps *WorkspaceCoordinatorDependencies) { deps.ClusterRuntime = nil }},
		{"ClusterWorkspace", func(deps *WorkspaceCoordinatorDependencies) { deps.ClusterWorkspace = nil }},
		{"Refresh", func(deps *WorkspaceCoordinatorDependencies) { deps.Refresh = nil }},
		{"Preferences", func(deps *WorkspaceCoordinatorDependencies) { deps.Preferences = nil }},
		{"Operations", func(deps *WorkspaceCoordinatorDependencies) { deps.Operations = nil }},
		{"Logger", func(deps *WorkspaceCoordinatorDependencies) { deps.Logger = nil }},
		{"Context", func(deps *WorkspaceCoordinatorDependencies) { deps.Context = nil }},
		{"RuntimeAvailable", func(deps *WorkspaceCoordinatorDependencies) { deps.RuntimeAvailable = nil }},
		{"EmitEvent", func(deps *WorkspaceCoordinatorDependencies) { deps.EmitEvent = nil }},
	}
	for _, testCase := range workspaceCases {
		t.Run("Workspace/"+testCase.name, func(t *testing.T) {
			dependencies := workspaceDependencies()
			testCase.remove(&dependencies)
			require.Panics(t, func() { newWorkspaceCoordinator(dependencies) })
		})
	}
	require.NotPanics(t, func() { newWorkspaceCoordinator(workspaceDependencies()) })
}

func TestServiceStartupInstallsErrorCaptureBeforeRuntimeWork(t *testing.T) {
	source, err := os.ReadFile("application_lifecycle.go")
	require.NoError(t, err)
	startup := string(source)

	ordered := []string{
		"errorcapture.Init()",
		"errorcapture.InstallUnhandledErrorDedup()",
		"a.setApplicationContext(ctx)",
		"a.clusterRuntime.consumeIntents",
		"a.clusterRuntime.initializeClusterLifecycle()",
	}
	previous := -1
	for _, operation := range ordered {
		index := strings.Index(startup, operation)
		require.Greater(t, index, previous, "%s must remain in startup order", operation)
		previous = index
	}
}
