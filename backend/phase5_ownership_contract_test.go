package backend

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPhase5RuntimeOwnersAreComposedWithoutDisplacedAppState(t *testing.T) {
	app := NewApp(nil)
	require.NotNil(t, app.ClusterRuntimeManager)
	require.NotNil(t, app.ClusterWorkspaceProjection)
	require.NotNil(t, app.RefreshCoordinator)
	require.NotNil(t, app.WorkspaceCoordinator)

	appType := reflect.TypeOf(App{})
	directFields := make(map[string]struct{}, appType.NumField())
	for index := 0; index < appType.NumField(); index++ {
		directFields[appType.Field(index).Name] = struct{}{}
	}
	for _, field := range []string{
		"availableKubeconfigs", "kubeconfigDiscoveryState", "kubeconfigWatcher",
		"clusterClientsMu", "clusterClients", "clusterOps", "clusterLifecycle",
		"kubeAPIMetrics", "transportStatesMu", "transportStates", "kubeClientInitializer",
		"clusterWorkspaceMu", "clusterWorkspaceRevision", "clusterHealth", "clusterScopeRevisions",
		"refreshManager", "refreshService", "refreshRuntimeMu", "refreshDone", "refreshCancel",
		"refreshRuntimeStopped", "telemetryRecorder", "sharedInformerFactory",
		"apiExtensionsInformerFactory", "refreshSubsystemsMu", "refreshSubsystems",
		"refreshAggregates", "refreshPermissionCancels", "containerLogsTargetLimiterMu",
		"containerLogsTargetLimiter", "governorReconcileMu", "governorMu", "governorPolicy",
		"governorMRU", "governorVisible", "governorWindows", "governorPlanned",
		"governorApplied", "governorPressure", "governorHeapInuse", "governorBudget",
		"governorNow", "spillRoot", "spillFormat", "cooledMu", "cooledMmapClosers",
		"objectCatalogMu", "objectCatalogEntries", "selectedKubeconfigs", "kubeconfigsMu",
		"selectionMutationMu", "workspaceSelections", "selectionMutationDrainMu",
		"selectionMutationDrainCond", "selectionMutationPending", "kubeconfigChangeMu",
		"selectionGeneration", "selectionGenCtxMu", "selectionGenCancel", "selectionDiag",
		"requestClusterScopeRebuildFn", "scopeRebuildQueued",
	} {
		_, found := directFields[field]
		require.Falsef(t, found, "App still owns displaced Phase 5 field %s", field)
	}

	appPointer := reflect.TypeOf((*App)(nil))
	for _, owner := range []any{
		ClusterRuntimeManager{}, ClusterWorkspaceProjection{}, RefreshCoordinator{}, WorkspaceCoordinator{},
	} {
		ownerType := reflect.TypeOf(owner)
		for index := 0; index < ownerType.NumField(); index++ {
			require.NotEqualf(t, appPointer, ownerType.Field(index).Type, "%s retains an App back-pointer", ownerType.Name())
		}
	}
}

func TestResourceGatewayUsesLeafRefreshProjectionWithoutRefreshCallbacks(t *testing.T) {
	projectionType := reflect.TypeOf((*refreshResourceProjection)(nil))
	for _, value := range []any{resourceGatewayDependencies{}, ResourceGateway{}} {
		valueType := reflect.TypeOf(value)
		field, found := valueType.FieldByName("refreshProjection")
		require.Truef(t, found, "%s must receive the leaf refresh projection", valueType.Name())
		require.Equal(t, projectionType, field.Type)
		for _, callback := range []string{
			"retryTelemetry", "retryTelemetryFn",
			"catalogServiceForCluster", "catalogServiceForClusterFn",
			"catalogEntries", "catalogEntriesFn",
			"catalogTelemetry", "catalogTelemetryFn",
		} {
			_, found := valueType.FieldByName(callback)
			require.Falsef(t, found, "%s retains refresh callback %s", valueType.Name(), callback)
		}
	}
}
