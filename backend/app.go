package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
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
	// Process-global Kubernetes logging must be installed before any owner can
	// start a client or informer. Both installers are idempotent.
	errorcapture.Init()
	errorcapture.InstallUnhandledErrorDedup()

	var reporter sentryreporting.Reporter
	if len(reporters) > 0 {
		reporter = reporters[0]
	}
	appLogs := NewAppLogService(NewLogger(1000, reporters...))
	signals := newApplicationRuntimeSignals(
		func(_ context.Context, name string, data ...interface{}) {
			if wailsApplication != nil {
				wailsApplication.Event.Emit(name, data...)
			}
		},
	)
	clusterWorkspace := newClusterWorkspaceProjection()
	containerLogsPolicy := NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit)
	permissionFetchPolicy := NewPermissionFetchPolicy(defaultPermissionSSRRFetchConcurrency)
	desktopShell := NewDesktopShell(wailsApplication, signals.runtimeAvailable, signals.emitEvent, appLogs.Logger())
	updates := NewUpdateCoordinator(desktopShell, signals.CtxOrBackground, signals.emitEvent, appLogs.Logger())
	desktopShell.ConfigureUpdateCheck(func() error {
		_, err := updates.CheckForUpdates()
		return err
	})
	errorReporting := NewErrorReportingService(reporter, signals.CtxOrBackground, appLogs.Logger())
	refreshSettings := newRefreshSettingBridge(
		defaultObjPanelLogsTargetGlobalLimit,
		defaultMetricsIntervalMs(),
	)
	clusterRuntime := newClusterRuntimeManager(ClusterRuntimeManagerDependencies{
		Logger: appLogs.Logger(), ContainerLogsPolicy: containerLogsPolicy,
		Projection: clusterWorkspace, EmitEvent: signals.emitEvent, Context: signals.CtxOrBackground,
	})

	// Preferences pushes live settings to Cluster Runtime, while Cluster Runtime
	// reads the persisted kubeconfig search-path repository. The manager starts
	// with an explicit unavailable repository and is bound here before any
	// discovery or settings load can run.
	preferences := NewPreferencesService(
		desktopShell,
		NewSettingsEffectDispatcher(errorReporting, clusterRuntime, permissionFetchPolicy, containerLogsPolicy, refreshSettings, appLogs.Logger()),
		appLogs.Logger(),
	)
	clusterRuntime.configureDiscoveryRepository(preferences)
	desktopShell.ConfigureKubeconfigSearchPaths(preferences.KubeconfigSearchPaths)
	attention := NewClusterAttentionService(preferences, appLogs.Logger())
	resourceProjection := newRefreshResourceProjection()
	operations := newApplicationOperationsCoordinator(
		clusterRuntime, resourceProjection, signals.CtxOrBackground, signals.emitEvent, appLogs.Logger(),
	)
	resources := newResourceGateway(resourceGatewayDependencies{
		resolveClusterDependencies:       clusterRuntime.resolveClusterDependencies,
		resourceDependenciesForClusterID: clusterRuntime.resourceDependenciesForClusterID,
		context:                          signals.CtxOrBackground,
		emitEvent:                        signals.emitEvent,
		logger:                           appLogs.Logger(),
		clusterName:                      clusterRuntime.clusterNameForID,
		recordTransportSuccess:           clusterRuntime.recordClusterTransportSuccess,
		recordTransportFailure:           clusterRuntime.recordClusterTransportFailure,
		resourceResolverForCluster: func(clusterID string) common.ResourceResolver {
			return clusterRuntimeResourceResolver{
				runtime: clusterRuntime, clusterID: clusterID,
				catalogService: resourceProjection.objectCatalogServiceForCluster,
			}
		},
		refreshProjection:            resourceProjection,
		permissionFetchPolicy:        permissionFetchPolicy,
		containerLogsSelectionPolicy: containerLogsPolicy,
		operations:                   operations,
	})
	refresh := newRefreshCoordinator(RefreshCoordinatorDependencies{
		ClusterRuntime: clusterRuntime, ClusterWorkspace: clusterWorkspace,
		Attention: attention, Logger: appLogs.Logger(),
		AllowedNamespaces: func(clusterID string) []string {
			namespaces, err := preferences.clusterAllowedNamespaces(clusterID)
			if err != nil {
				appLogs.Logger().Warn(fmt.Sprintf("Could not read allowed namespaces for cluster %s (running cluster-wide): %v", clusterID, err), "Settings", clusterID, clusterID)
				return nil
			}
			return namespaces
		},
		Preferences: preferences, ContainerLogsPolicy: containerLogsPolicy,
		PermissionFetchPolicy: permissionFetchPolicy, Resources: resources,
		AppLogs: appLogs, Context: signals.CtxOrBackground,
		RuntimeAvailable: signals.runtimeAvailable, EmitEvent: signals.emitEvent,
		ResourceProjection: resourceProjection,
	})

	refreshSettings.Bind(refresh)
	workspace := newWorkspaceCoordinator(WorkspaceCoordinatorDependencies{
		ClusterRuntime: clusterRuntime, ClusterWorkspace: clusterWorkspace, Refresh: refresh,
		Preferences: preferences, Operations: operations, Resources: resources, AppLogs: appLogs,
		Context: signals.CtxOrBackground, RuntimeAvailable: signals.runtimeAvailable, EmitEvent: signals.emitEvent,
	})
	favorites := NewFavoritesService()
	uiState := NewUIStateStore()
	dataManagement := NewDataManagementCoordinator(DataManagementDependencies{
		Preferences: preferences, Favorites: favorites, UIState: uiState,
		Updates: updates, Attention: attention, ErrorReporting: errorReporting,
		AppLogs: appLogs, DesktopShell: desktopShell,
		RuntimeAvailable: signals.runtimeAvailable, Context: signals.CtxOrBackground,
		WorkspaceMutation: func(name string, action func() error) error {
			return workspace.runSelectionMutation(name, func(_ *selectionMutation) error { return action() })
		},
		ResetRuntime: func() error {
			if err := workspace.clearKubeconfigSelection(); err != nil {
				return err
			}
			return refresh.ResetRuntimeState()
		},
		SearchPathsChanged: workspace.refreshKubeconfigDiscoveryAfterSearchPathChange,
	})
	lifecycle := newApplicationLifecycle(signals, ApplicationLifecycleDependencies{
		DesktopShell: desktopShell, AppLogs: appLogs, Preferences: preferences,
		ErrorReporting: errorReporting, ClusterRuntime: clusterRuntime, Refresh: refresh,
		Workspace: workspace, Operations: operations, Updates: updates,
	})
	errorReporting.ConfigureInstallationTelemetry(preferences)
	lifecycle.setupEnvironment()
	refresh.initGovernor()

	return &ApplicationRuntime{
		Lifecycle: lifecycle, ClusterRuntime: clusterRuntime, ClusterWorkspace: clusterWorkspace,
		Refresh: refresh, Workspace: workspace, DesktopShell: desktopShell, AppLogs: appLogs,
		Favorites: favorites, UIState: uiState, Preferences: preferences,
		ErrorReporting: errorReporting, ContainerLogsPolicy: containerLogsPolicy,
		PermissionFetchPolicy: permissionFetchPolicy, DataManagement: dataManagement,
		Attention: attention, Resources: resources, Operations: operations, Updates: updates,
	}
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
