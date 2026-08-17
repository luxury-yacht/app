package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	RefreshResourceStreamName      = "refresh-resources"
	RefreshContainerLogsStreamName = "refresh-container-logs"
)

// ApplicationRuntime is the reference-only composition result. Behavior and
// mutable domain state belong to the referenced owners.
type ApplicationRuntime struct {
	Lifecycle             *ApplicationLifecycle
	ClusterRuntime        *ClusterRuntimeManager
	ClusterWorkspace      *ClusterWorkspaceProjection
	Refresh               *RefreshCoordinator
	Workspace             *WorkspaceCoordinator
	DesktopShell          *DesktopShell
	AppLogs               *AppLogService
	Favorites             *FavoritesService
	UIState               *UIStateStore
	Preferences           *PreferencesService
	ErrorReporting        *ErrorReportingService
	ContainerLogsPolicy   *ContainerLogsSelectionPolicy
	PermissionFetchPolicy *PermissionFetchPolicy
	DataManagement        *DataManagementCoordinator
	Attention             *ClusterAttentionService
	Resources             *ResourceGateway
	Operations            *OperationsCoordinator
	Updates               *UpdateCoordinator
}

type applicationUpdateCoordinator interface {
	Snapshot() appupdates.Snapshot
	RuntimeReady()
	Stop()
	Check(context.Context) (appupdates.Snapshot, error)
	Download(context.Context, string) (appupdates.Snapshot, error)
	Restart(context.Context) (appupdates.Snapshot, error)
	Skip(context.Context, string) (appupdates.Snapshot, error)
	RemoveSkip(context.Context) (appupdates.Snapshot, error)
}

// NewApplicationRuntime composes focused backend owners around the concrete
// Wails application without retaining behavior on the composition result.
func NewApplicationRuntime(wailsApplication *application.App, reporters ...sentryreporting.Reporter) *ApplicationRuntime {
	var reporter sentryreporting.Reporter
	if len(reporters) > 0 {
		reporter = reporters[0]
	}
	lifecycle := &ApplicationLifecycle{
		appLogs: NewAppLogService(NewLogger(1000, reporters...)),
		eventEmitter: func(_ context.Context, name string, data ...interface{}) {
			if wailsApplication != nil {
				wailsApplication.Event.Emit(name, data...)
			}
		},
	}
	runtime := &ApplicationRuntime{
		Lifecycle:             lifecycle,
		ClusterRuntime:        newClusterRuntimeManager(),
		ClusterWorkspace:      newClusterWorkspaceProjection(),
		Refresh:               newRefreshCoordinator(),
		Workspace:             newWorkspaceCoordinator(),
		AppLogs:               lifecycle.appLogs,
		Favorites:             NewFavoritesService(),
		UIState:               NewUIStateStore(),
		ContainerLogsPolicy:   NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit),
		PermissionFetchPolicy: NewPermissionFetchPolicy(defaultPermissionSSRRFetchConcurrency),
	}
	runtime.DesktopShell = NewDesktopShell(wailsApplication, lifecycle.runtimeAvailable, lifecycle.emitEvent, runtime.AppLogs.Logger())
	runtime.Updates = NewUpdateCoordinator(runtime.DesktopShell, lifecycle.CtxOrBackground, lifecycle.emitEvent, runtime.AppLogs.Logger())
	runtime.DesktopShell.ConfigureUpdateCheck(func() error {
		_, err := runtime.Updates.CheckForUpdates()
		return err
	})
	runtime.ErrorReporting = NewErrorReportingService(reporter, lifecycle.CtxOrBackground, runtime.AppLogs.Logger())
	runtime.Preferences = NewPreferencesService(
		runtime.DesktopShell,
		NewSettingsEffectDispatcher(runtime.ErrorReporting, runtime.ClusterRuntime, runtime.PermissionFetchPolicy, runtime.ContainerLogsPolicy, runtime.Refresh, runtime.AppLogs.Logger()),
		runtime.AppLogs.Logger(),
	)
	runtime.ClusterRuntime.discoveryRepository = runtime.Preferences
	runtime.ClusterRuntime.logger = runtime.AppLogs.Logger()
	runtime.ClusterRuntime.containerLogsPolicy = runtime.ContainerLogsPolicy
	runtime.ClusterRuntime.projection = runtime.ClusterWorkspace
	runtime.ClusterRuntime.emitEvent = lifecycle.emitEvent
	runtime.ClusterRuntime.context = lifecycle.CtxOrBackground
	runtime.DesktopShell.ConfigureKubeconfigSearchPaths(runtime.Preferences.KubeconfigSearchPaths)
	runtime.Attention = NewClusterAttentionService(runtime.Preferences, runtime.AppLogs.Logger())
	runtime.Refresh.ClusterRuntimeManager = runtime.ClusterRuntime
	runtime.Refresh.ClusterWorkspaceProjection = runtime.ClusterWorkspace
	runtime.Refresh.attention = runtime.Attention
	runtime.Refresh.logger = runtime.AppLogs.Logger()
	runtime.Refresh.preferences = runtime.Preferences
	runtime.Refresh.containerLogsPolicy = runtime.ContainerLogsPolicy
	runtime.Refresh.permissionFetchPolicy = runtime.PermissionFetchPolicy
	runtime.Refresh.appLogs = runtime.AppLogs
	runtime.Refresh.context = lifecycle.CtxOrBackground
	runtime.Refresh.runtimeAvailableFn = lifecycle.runtimeAvailable
	runtime.Refresh.emitEventFn = lifecycle.emitEvent
	runtime.Refresh.allowedNamespaces = func(clusterID string) []string {
		namespaces, err := runtime.Preferences.clusterAllowedNamespaces(clusterID)
		if err != nil {
			runtime.AppLogs.Logger().Warn(fmt.Sprintf("Could not read allowed namespaces for cluster %s (running cluster-wide): %v", clusterID, err), "Settings", clusterID, clusterID)
			return nil
		}
		return namespaces
	}
	runtime.ErrorReporting.ConfigureInstallationTelemetry(runtime.Preferences)
	lifecycle.setupEnvironment()
	runtime.Refresh.initGovernor()
	runtime.Operations = newApplicationOperationsCoordinator(runtime.ClusterRuntime, runtime.Refresh.resourceProjection, lifecycle, runtime.AppLogs.Logger())
	runtime.Resources = newResourceGateway(resourceGatewayDependencies{
		resolveClusterDependencies:       runtime.ClusterRuntime.resolveClusterDependencies,
		resourceDependenciesForClusterID: runtime.ClusterRuntime.resourceDependenciesForClusterID,
		context:                          lifecycle.CtxOrBackground,
		emitEvent:                        lifecycle.emitEvent,
		logger:                           runtime.AppLogs.Logger(),
		clusterName:                      runtime.ClusterRuntime.clusterNameForID,
		recordTransportSuccess:           runtime.ClusterRuntime.recordClusterTransportSuccess,
		recordTransportFailure:           runtime.ClusterRuntime.recordClusterTransportFailure,
		resourceResolverForCluster: func(clusterID string) common.ResourceResolver {
			return clusterRuntimeResourceResolver{
				runtime:        runtime.ClusterRuntime,
				clusterID:      clusterID,
				catalogService: runtime.Refresh.resourceProjection.objectCatalogServiceForCluster,
			}
		},
		refreshProjection:            runtime.Refresh.resourceProjection,
		permissionFetchPolicy:        runtime.PermissionFetchPolicy,
		containerLogsSelectionPolicy: runtime.ContainerLogsPolicy,
		operations:                   runtime.Operations,
	})
	runtime.Refresh.resources = runtime.Resources
	runtime.Workspace.ClusterRuntimeManager = runtime.ClusterRuntime
	runtime.Workspace.ClusterWorkspaceProjection = runtime.ClusterWorkspace
	runtime.Workspace.RefreshCoordinator = runtime.Refresh
	runtime.Workspace.preferences = runtime.Preferences
	runtime.Workspace.operations = runtime.Operations
	runtime.Workspace.resources = runtime.Resources
	runtime.Workspace.appLogs = runtime.AppLogs
	runtime.Workspace.context = lifecycle.CtxOrBackground
	runtime.Workspace.runtimeAvailableFn = lifecycle.runtimeAvailable
	runtime.Workspace.emitEventFn = lifecycle.emitEvent
	runtime.Workspace.kubeClientInitializer = runtime.Workspace.initKubernetesClient
	workspace := runtime.Workspace
	refreshCoordinator := runtime.Refresh
	runtime.DataManagement = NewDataManagementCoordinator(DataManagementDependencies{
		Preferences: runtime.Preferences, Favorites: runtime.Favorites, UIState: runtime.UIState,
		Updates: runtime.Updates, Attention: runtime.Attention, ErrorReporting: runtime.ErrorReporting,
		AppLogs: runtime.AppLogs, DesktopShell: runtime.DesktopShell,
		RuntimeAvailable: lifecycle.runtimeAvailable, Context: lifecycle.CtxOrBackground,
		WorkspaceMutation: func(name string, action func() error) error {
			return workspace.runSelectionMutation(name, func(_ *selectionMutation) error { return action() })
		},
		ResetRuntime: func() error {
			if err := workspace.clearKubeconfigSelection(); err != nil {
				return err
			}
			return refreshCoordinator.ResetRuntimeState()
		},
		SearchPathsChanged: workspace.refreshKubeconfigDiscoveryAfterSearchPathChange,
	})
	lifecycle.desktopShell = runtime.DesktopShell
	lifecycle.preferences = runtime.Preferences
	lifecycle.errorReporting = runtime.ErrorReporting
	lifecycle.clusterRuntime = runtime.ClusterRuntime
	lifecycle.refresh = runtime.Refresh
	lifecycle.workspace = runtime.Workspace
	lifecycle.operations = runtime.Operations
	lifecycle.updates = runtime.Updates
	return runtime
}

func (a *ApplicationLifecycle) emitEvent(name string, args ...interface{}) {
	if a == nil || a.eventEmitter == nil || !a.runtimeAvailable() {
		return
	}
	a.eventEmitter(a.CtxOrBackground(), name, args...)
}

// RetryAuth triggers a manual authentication recovery attempt for ALL clusters.
// Called when user clicks "Retry" after re-authenticating externally.
// For per-cluster retry, use RetryClusterAuth instead.
func (a *ClusterRuntimeManager) RetryAuth() {
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()

	for _, clients := range a.clusterClients {
		if clients != nil && clients.authManager != nil {
			clients.authManager.TriggerRetry()
		}
	}
}
