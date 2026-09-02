package backend

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/common"
	sentryreporting "github.com/luxury-yacht/app/internal/sentry"
)

// lifecycleOwnerFixture is the shared process boundary required by focused
// owner fixtures. It contains no domain owner beyond logging and native shell.
type lifecycleOwnerFixture struct {
	Lifecycle    *ApplicationLifecycle
	AppLogs      *AppLogService
	DesktopShell *DesktopShell
	signals      *applicationRuntimeSignals
	searchPaths  *kubeconfigSearchPathPort
}

func newLifecycleOwnerFixture(t testing.TB, reporters ...sentryreporting.Reporter) *lifecycleOwnerFixture {
	t.Helper()
	logs := NewAppLogService(NewLogger(1000, reporters...))
	signals := newApplicationRuntimeSignals(func(context.Context, string, ...interface{}) {})
	fixture := &lifecycleOwnerFixture{
		AppLogs:     logs,
		signals:     signals,
		searchPaths: &kubeconfigSearchPathPort{},
	}
	fixture.DesktopShell = NewDesktopShell(
		nil, signals.runtimeAvailable, signals.emitEvent, logs.Logger(),
		DesktopShellBindings{KubeconfigSearchPaths: fixture.searchPaths.read},
	)
	fixture.Lifecycle = newApplicationLifecycle(signals, ApplicationLifecycleDependencies{
		DesktopShell: fixture.DesktopShell, Logger: logs.Logger(),
	})
	return fixture
}

// clusterRuntimeTestFixture composes only cluster discovery/client state and
// its leaf workspace projection.
type clusterRuntimeTestFixture struct {
	*lifecycleOwnerFixture
	Preferences           *PreferencesService
	ClusterRuntime        *ClusterRuntimeManager
	ClusterWorkspace      *ClusterWorkspaceProjection
	ContainerLogsPolicy   *ContainerLogsSelectionPolicy
	PermissionFetchPolicy *PermissionFetchPolicy
	ErrorReporting        *ErrorReportingService
	refreshSettings       *refreshSettingBridge
}

func newClusterRuntimeTestFixture(t testing.TB, reporters ...sentryreporting.Reporter) *clusterRuntimeTestFixture {
	t.Helper()
	base := newLifecycleOwnerFixture(t, reporters...)
	containerLogsPolicy := NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit)
	permissionPolicy := NewPermissionFetchPolicy(defaultPermissionSSRRFetchConcurrency)
	rateLimits := newClusterRateLimitBridge(defaultKubernetesClientQPS, defaultKubernetesClientBurst)
	refreshSettings := newRefreshSettingBridge(defaultObjPanelLogsTargetGlobalLimit, defaultMetricsIntervalMs())
	installationTelemetry := &installationTelemetryPort{}
	errorReporting := NewErrorReportingService(
		firstReporter(reporters), base.signals.CtxOrBackground, base.AppLogs.Logger(), installationTelemetry,
	)
	preferences := NewPreferencesService(
		base.DesktopShell,
		NewSettingsEffectDispatcher(
			errorReporting, rateLimits, permissionPolicy, containerLogsPolicy, refreshSettings, base.AppLogs.Logger(),
		),
		base.AppLogs.Logger(), base.searchPaths, installationTelemetry,
	)
	projection := newClusterWorkspaceProjection()
	clusterRuntime := newClusterRuntimeManager(ClusterRuntimeManagerDependencies{
		DiscoveryRepository: preferences, Logger: base.AppLogs.Logger(),
		ContainerLogsPolicy: containerLogsPolicy, Projection: projection,
		EmitEvent: base.signals.emitEvent, Context: base.signals.CtxOrBackground,
		RateLimitsBridge: rateLimits,
	})
	base.Lifecycle = newApplicationLifecycle(base.signals, ApplicationLifecycleDependencies{
		DesktopShell: base.DesktopShell, Logger: base.AppLogs.Logger(), Preferences: preferences,
		ErrorReporting: errorReporting, ClusterRuntime: clusterRuntime,
	})
	return &clusterRuntimeTestFixture{
		lifecycleOwnerFixture: base,
		Preferences:           preferences,
		ClusterRuntime:        clusterRuntime,
		ClusterWorkspace:      projection,
		ContainerLogsPolicy:   containerLogsPolicy,
		PermissionFetchPolicy: permissionPolicy,
		ErrorReporting:        errorReporting,
		refreshSettings:       refreshSettings,
	}
}

// refreshCoordinatorTestFixture extends cluster ownership only with refresh
// state and the settings targets that refresh itself consumes.
type refreshCoordinatorTestFixture struct {
	*clusterRuntimeTestFixture
	Refresh              *RefreshCoordinator
	Attention            *ClusterAttentionService
	Operations           *OperationsCoordinator
	Resources            *ResourceGateway
	NodeMaintenanceStore *nodemaintenance.Store
}

func newRefreshCoordinatorTestFixture(t testing.TB, reporters ...sentryreporting.Reporter) *refreshCoordinatorTestFixture {
	t.Helper()
	cluster := newClusterRuntimeTestFixture(t, reporters...)
	attention := NewClusterAttentionService(cluster.Preferences, cluster.AppLogs.Logger())
	resourceProjection := newRefreshResourceProjection()
	nodeMaintenanceStore := nodemaintenance.NewStore(5)
	operations := newApplicationOperationsCoordinator(
		cluster.ClusterRuntime,
		resourceProjection,
		nodeMaintenanceStore,
		cluster.signals.CtxOrBackground,
		cluster.signals.emitEvent,
		cluster.AppLogs.Logger(),
	)
	resources := newResourceGateway(resourceGatewayDependencies{
		resolveClusterDependencies:       cluster.ClusterRuntime.resolveClusterDependencies,
		resourceDependenciesForClusterID: cluster.ClusterRuntime.resourceDependenciesForClusterID,
		context:                          cluster.signals.CtxOrBackground,
		emitEvent:                        cluster.signals.emitEvent,
		logger:                           cluster.AppLogs.Logger(),
		clusterName:                      cluster.ClusterRuntime.clusterNameForID,
		recordTransportSuccess:           cluster.ClusterRuntime.recordClusterTransportSuccess,
		recordTransportFailure:           cluster.ClusterRuntime.recordClusterTransportFailure,
		resourceResolverForCluster: func(clusterID string) common.ResourceResolver {
			return clusterRuntimeResourceResolver{
				runtime:        cluster.ClusterRuntime,
				clusterID:      clusterID,
				catalogService: resourceProjection.objectCatalogServiceForCluster,
			}
		},
		refreshProjection:            resourceProjection,
		permissionFetchPolicy:        cluster.PermissionFetchPolicy,
		containerLogsSelectionPolicy: cluster.ContainerLogsPolicy,
		nodeMaintenanceStore:         nodeMaintenanceStore,
		operations:                   operations,
	})
	refreshCoordinator := newRefreshCoordinator(RefreshCoordinatorDependencies{
		ClusterRuntime: cluster.ClusterRuntime, ClusterWorkspace: cluster.ClusterWorkspace,
		Attention: attention, Logger: cluster.AppLogs.Logger(), Preferences: cluster.Preferences,
		ContainerLogsPolicy: cluster.ContainerLogsPolicy, PermissionFetchPolicy: cluster.PermissionFetchPolicy,
		Resources: resources, Context: cluster.signals.CtxOrBackground,
		RuntimeAvailable:     cluster.signals.runtimeAvailable,
		EmitEvent:            cluster.signals.emitEvent,
		ResourceProjection:   resourceProjection,
		NodeMaintenanceStore: nodeMaintenanceStore,
		SettingsBridge:       cluster.refreshSettings,
		AllowedNamespaces: func(clusterID string) []string {
			namespaces, _ := cluster.Preferences.clusterAllowedNamespaces(clusterID)
			return namespaces
		},
	})
	refreshCoordinator.initGovernor()
	cluster.Lifecycle = newApplicationLifecycle(cluster.signals, ApplicationLifecycleDependencies{
		DesktopShell: cluster.DesktopShell, Logger: cluster.AppLogs.Logger(), Preferences: cluster.Preferences,
		ErrorReporting: cluster.ErrorReporting, ClusterRuntime: cluster.ClusterRuntime,
		Refresh: refreshCoordinator, Operations: operations,
	})
	return &refreshCoordinatorTestFixture{
		clusterRuntimeTestFixture: cluster,
		Refresh:                   refreshCoordinator,
		Attention:                 attention,
		Operations:                operations,
		Resources:                 resources,
		NodeMaintenanceStore:      nodeMaintenanceStore,
	}
}

// workspaceCoordinatorTestFixture adds the serialized selection owner and the
// resource/operation collaborators that selection workflows invalidate.
type workspaceCoordinatorTestFixture struct {
	*refreshCoordinatorTestFixture
	Workspace *WorkspaceCoordinator
}

func newWorkspaceCoordinatorTestFixture(t testing.TB, reporters ...sentryreporting.Reporter) *workspaceCoordinatorTestFixture {
	t.Helper()
	refreshFixture := newRefreshCoordinatorTestFixture(t, reporters...)
	workspace := newWorkspaceCoordinator(WorkspaceCoordinatorDependencies{
		ClusterRuntime: refreshFixture.ClusterRuntime, ClusterWorkspace: refreshFixture.ClusterWorkspace,
		Refresh: refreshFixture.Refresh, Preferences: refreshFixture.Preferences,
		Operations: refreshFixture.Operations, Logger: refreshFixture.AppLogs.Logger(),
		Context:           refreshFixture.signals.CtxOrBackground,
		RuntimeAvailable:  refreshFixture.signals.runtimeAvailable,
		IsWorkspaceWindow: func(string) bool { return true },
		EmitEvent:         refreshFixture.signals.emitEvent,
	})
	refreshFixture.Lifecycle = newApplicationLifecycle(refreshFixture.signals, ApplicationLifecycleDependencies{
		DesktopShell: refreshFixture.DesktopShell, Logger: refreshFixture.AppLogs.Logger(),
		Preferences: refreshFixture.Preferences, ErrorReporting: refreshFixture.ErrorReporting,
		ClusterRuntime: refreshFixture.ClusterRuntime, Refresh: refreshFixture.Refresh,
		Workspace: workspace, Operations: refreshFixture.Operations,
	})
	return &workspaceCoordinatorTestFixture{
		refreshCoordinatorTestFixture: refreshFixture,
		Workspace:                     workspace,
	}
}

type persistenceTestFixture struct {
	Favorites *FavoritesService
	UIState   *UIStateStore
}

func newPersistenceTestFixture() *persistenceTestFixture {
	return &persistenceTestFixture{
		Favorites: NewFavoritesService(),
		UIState:   NewUIStateStore(),
	}
}

type updateCoordinatorTestFixture struct {
	*lifecycleOwnerFixture
	Updates *UpdateCoordinator
}

func newUpdateCoordinatorTestFixture(t testing.TB, configured ...ApplicationUpdateOptions) *updateCoordinatorTestFixture {
	t.Helper()
	base := newLifecycleOwnerFixture(t)
	var options ApplicationUpdateOptions
	if len(configured) > 0 {
		options = configured[0]
	}
	updates := NewUpdateCoordinator(
		base.DesktopShell, base.signals.CtxOrBackground, base.signals.emitEvent,
		base.AppLogs.Logger(), options,
	)
	base.Lifecycle = newApplicationLifecycle(base.signals, ApplicationLifecycleDependencies{
		DesktopShell: base.DesktopShell, Logger: base.AppLogs.Logger(), Updates: updates,
	})
	return &updateCoordinatorTestFixture{lifecycleOwnerFixture: base, Updates: updates}
}

// settingsEffectsTestFixture includes every owner targeted by the single
// PreferencesService settings-effect dispatcher, plus reset persistence.
type settingsEffectsTestFixture struct {
	*workspaceCoordinatorTestFixture
	ErrorReporting *ErrorReportingService
	Favorites      *FavoritesService
	UIState        *UIStateStore
	Updates        *UpdateCoordinator
	DataManagement *DataManagementCoordinator
}

func newSettingsEffectsTestFixture(t testing.TB, reporters ...sentryreporting.Reporter) *settingsEffectsTestFixture {
	t.Helper()
	fixture := newWorkspaceCoordinatorTestFixture(t, reporters...)
	errorReporting := fixture.ErrorReporting
	updates := NewUpdateCoordinator(
		fixture.DesktopShell, fixture.signals.CtxOrBackground, fixture.signals.emitEvent,
		fixture.AppLogs.Logger(), ApplicationUpdateOptions{},
	)
	favorites := NewFavoritesService()
	uiState := NewUIStateStore()
	staticState := newStaticAppStateCleaner("luxury-yacht")
	dataManagement := NewDataManagementCoordinator(DataManagementDependencies{
		Preferences: fixture.Preferences, Favorites: favorites, UIState: uiState,
		Updates: updates, StaticState: staticState,
		Attention: fixture.Attention, ErrorReporting: errorReporting,
		AppLogs: fixture.AppLogs, DesktopShell: fixture.DesktopShell,
		RuntimeAvailable: fixture.signals.runtimeAvailable, Context: fixture.signals.CtxOrBackground,
		WorkspaceMutation: func(name string, action func() error) error {
			return fixture.Workspace.runSelectionMutation(name, func(_ *selectionMutation) error { return action() })
		},
		ResetRuntime: func() error {
			if err := fixture.Workspace.clearKubeconfigSelection(); err != nil {
				return err
			}
			return fixture.Refresh.ResetRuntimeState()
		},
		SearchPathsChanged: fixture.Workspace.refreshKubeconfigDiscoveryAfterSearchPathChange,
	})
	fixture.Lifecycle = newApplicationLifecycle(fixture.signals, ApplicationLifecycleDependencies{
		DesktopShell: fixture.DesktopShell, Logger: fixture.AppLogs.Logger(), StartupState: staticState, Preferences: fixture.Preferences,
		ErrorReporting: errorReporting, ClusterRuntime: fixture.ClusterRuntime, Refresh: fixture.Refresh,
		Workspace: fixture.Workspace, Operations: fixture.Operations, Updates: updates,
	})
	return &settingsEffectsTestFixture{
		workspaceCoordinatorTestFixture: fixture,
		ErrorReporting:                  errorReporting,
		Favorites:                       favorites,
		UIState:                         uiState,
		Updates:                         updates,
		DataManagement:                  dataManagement,
	}
}

func firstReporter(reporters []sentryreporting.Reporter) sentryreporting.Reporter {
	if len(reporters) == 0 {
		return nil
	}
	return reporters[0]
}
