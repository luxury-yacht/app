package backend

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	sentryreporting "github.com/luxury-yacht/app/internal/sentry"
)

// lifecycleOwnerFixture is the shared process boundary required by focused
// owner fixtures. It contains no domain owner beyond logging and native shell.
type lifecycleOwnerFixture struct {
	Lifecycle    *ApplicationLifecycle
	AppLogs      *AppLogService
	DesktopShell *DesktopShell
}

func newLifecycleOwnerFixture(t testing.TB, reporters ...sentryreporting.Reporter) *lifecycleOwnerFixture {
	t.Helper()
	logs := NewAppLogService(NewLogger(1000, reporters...))
	lifecycle := &ApplicationLifecycle{
		appLogs: logs,
		eventEmitter: func(context.Context, string, ...interface{}) {
		},
	}
	fixture := &lifecycleOwnerFixture{
		Lifecycle: lifecycle,
		AppLogs:   logs,
	}
	fixture.DesktopShell = NewDesktopShell(nil, lifecycle.runtimeAvailable, lifecycle.emitEvent, logs.Logger())
	lifecycle.desktopShell = fixture.DesktopShell
	lifecycle.setupEnvironment()
	return fixture
}

// clusterRuntimeTestFixture composes only cluster discovery/client state and
// its leaf workspace projection.
type clusterRuntimeTestFixture struct {
	*lifecycleOwnerFixture
	Preferences         *PreferencesService
	ClusterRuntime      *ClusterRuntimeManager
	ClusterWorkspace    *ClusterWorkspaceProjection
	ContainerLogsPolicy *ContainerLogsSelectionPolicy
}

func newClusterRuntimeTestFixture(t testing.TB, reporters ...sentryreporting.Reporter) *clusterRuntimeTestFixture {
	t.Helper()
	base := newLifecycleOwnerFixture(t, reporters...)
	preferences := NewPreferencesService(base.DesktopShell, nil, base.AppLogs.Logger())
	projection := newClusterWorkspaceProjection()
	containerLogsPolicy := NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit)
	clusterRuntime := newClusterRuntimeManager()
	clusterRuntime.discoveryRepository = preferences
	clusterRuntime.logger = base.AppLogs.Logger()
	clusterRuntime.containerLogsPolicy = containerLogsPolicy
	clusterRuntime.projection = projection
	clusterRuntime.emitEvent = base.Lifecycle.emitEvent
	clusterRuntime.context = base.Lifecycle.CtxOrBackground
	base.DesktopShell.ConfigureKubeconfigSearchPaths(preferences.KubeconfigSearchPaths)
	base.Lifecycle.clusterRuntime = clusterRuntime
	return &clusterRuntimeTestFixture{
		lifecycleOwnerFixture: base,
		Preferences:           preferences,
		ClusterRuntime:        clusterRuntime,
		ClusterWorkspace:      projection,
		ContainerLogsPolicy:   containerLogsPolicy,
	}
}

// refreshCoordinatorTestFixture extends cluster ownership only with refresh
// state and the settings targets that refresh itself consumes.
type refreshCoordinatorTestFixture struct {
	*clusterRuntimeTestFixture
	Refresh               *RefreshCoordinator
	Attention             *ClusterAttentionService
	PermissionFetchPolicy *PermissionFetchPolicy
}

func newRefreshCoordinatorTestFixture(t testing.TB, reporters ...sentryreporting.Reporter) *refreshCoordinatorTestFixture {
	t.Helper()
	cluster := newClusterRuntimeTestFixture(t, reporters...)
	permissionPolicy := NewPermissionFetchPolicy(defaultPermissionSSRRFetchConcurrency)
	attention := NewClusterAttentionService(cluster.Preferences, cluster.AppLogs.Logger())
	refreshCoordinator := newRefreshCoordinator()
	refreshCoordinator.ClusterRuntimeManager = cluster.ClusterRuntime
	refreshCoordinator.ClusterWorkspaceProjection = cluster.ClusterWorkspace
	refreshCoordinator.attention = attention
	refreshCoordinator.logger = cluster.AppLogs.Logger()
	refreshCoordinator.preferences = cluster.Preferences
	refreshCoordinator.containerLogsPolicy = cluster.ContainerLogsPolicy
	refreshCoordinator.permissionFetchPolicy = permissionPolicy
	refreshCoordinator.appLogs = cluster.AppLogs
	refreshCoordinator.context = cluster.Lifecycle.CtxOrBackground
	refreshCoordinator.runtimeAvailableFn = cluster.Lifecycle.runtimeAvailable
	refreshCoordinator.emitEventFn = cluster.Lifecycle.emitEvent
	refreshCoordinator.allowedNamespaces = func(clusterID string) []string {
		namespaces, _ := cluster.Preferences.clusterAllowedNamespaces(clusterID)
		return namespaces
	}
	refreshCoordinator.initGovernor()
	cluster.Preferences.effects = NewSettingsEffectDispatcher(
		nil,
		cluster.ClusterRuntime,
		permissionPolicy,
		cluster.ContainerLogsPolicy,
		refreshCoordinator,
		cluster.AppLogs.Logger(),
	)
	cluster.Lifecycle.refresh = refreshCoordinator
	return &refreshCoordinatorTestFixture{
		clusterRuntimeTestFixture: cluster,
		Refresh:                   refreshCoordinator,
		Attention:                 attention,
		PermissionFetchPolicy:     permissionPolicy,
	}
}

// workspaceCoordinatorTestFixture adds the serialized selection owner and the
// resource/operation collaborators that selection workflows invalidate.
type workspaceCoordinatorTestFixture struct {
	*refreshCoordinatorTestFixture
	Workspace  *WorkspaceCoordinator
	Operations *OperationsCoordinator
	Resources  *ResourceGateway
}

func newWorkspaceCoordinatorTestFixture(t testing.TB, reporters ...sentryreporting.Reporter) *workspaceCoordinatorTestFixture {
	t.Helper()
	refreshFixture := newRefreshCoordinatorTestFixture(t, reporters...)
	operations := newApplicationOperationsCoordinator(
		refreshFixture.ClusterRuntime,
		refreshFixture.Refresh.resourceProjection,
		refreshFixture.Lifecycle,
		refreshFixture.AppLogs.Logger(),
	)
	resources := newResourceGateway(resourceGatewayDependencies{
		resolveClusterDependencies:       refreshFixture.ClusterRuntime.resolveClusterDependencies,
		resourceDependenciesForClusterID: refreshFixture.ClusterRuntime.resourceDependenciesForClusterID,
		context:                          refreshFixture.Lifecycle.CtxOrBackground,
		emitEvent:                        refreshFixture.Lifecycle.emitEvent,
		logger:                           refreshFixture.AppLogs.Logger(),
		clusterName:                      refreshFixture.ClusterRuntime.clusterNameForID,
		recordTransportSuccess:           refreshFixture.ClusterRuntime.recordClusterTransportSuccess,
		recordTransportFailure:           refreshFixture.ClusterRuntime.recordClusterTransportFailure,
		resourceResolverForCluster: func(clusterID string) common.ResourceResolver {
			return clusterRuntimeResourceResolver{
				runtime:        refreshFixture.ClusterRuntime,
				clusterID:      clusterID,
				catalogService: refreshFixture.Refresh.resourceProjection.objectCatalogServiceForCluster,
			}
		},
		refreshProjection:            refreshFixture.Refresh.resourceProjection,
		permissionFetchPolicy:        refreshFixture.PermissionFetchPolicy,
		containerLogsSelectionPolicy: refreshFixture.ContainerLogsPolicy,
		operations:                   operations,
	})
	refreshFixture.Refresh.resources = resources
	workspace := newWorkspaceCoordinator()
	workspace.ClusterRuntimeManager = refreshFixture.ClusterRuntime
	workspace.ClusterWorkspaceProjection = refreshFixture.ClusterWorkspace
	workspace.RefreshCoordinator = refreshFixture.Refresh
	workspace.preferences = refreshFixture.Preferences
	workspace.operations = operations
	workspace.resources = resources
	workspace.appLogs = refreshFixture.AppLogs
	workspace.context = refreshFixture.Lifecycle.CtxOrBackground
	workspace.runtimeAvailableFn = refreshFixture.Lifecycle.runtimeAvailable
	workspace.emitEventFn = refreshFixture.Lifecycle.emitEvent
	workspace.kubeClientInitializer = workspace.initKubernetesClient
	refreshFixture.Lifecycle.workspace = workspace
	refreshFixture.Lifecycle.operations = operations
	return &workspaceCoordinatorTestFixture{
		refreshCoordinatorTestFixture: refreshFixture,
		Workspace:                     workspace,
		Operations:                    operations,
		Resources:                     resources,
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

func newUpdateCoordinatorTestFixture(t testing.TB) *updateCoordinatorTestFixture {
	t.Helper()
	base := newLifecycleOwnerFixture(t)
	updates := NewUpdateCoordinator(base.DesktopShell, base.Lifecycle.CtxOrBackground, base.Lifecycle.emitEvent, base.AppLogs.Logger())
	base.Lifecycle.updates = updates
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
	errorReporting := NewErrorReportingService(firstReporter(reporters), fixture.Lifecycle.CtxOrBackground, fixture.AppLogs.Logger())
	fixture.Preferences.logger = fixture.AppLogs.Logger()
	fixture.Preferences.effects = NewSettingsEffectDispatcher(
		errorReporting,
		fixture.ClusterRuntime,
		fixture.PermissionFetchPolicy,
		fixture.ContainerLogsPolicy,
		fixture.Refresh,
		fixture.AppLogs.Logger(),
	)
	errorReporting.ConfigureInstallationTelemetry(fixture.Preferences)
	updates := NewUpdateCoordinator(fixture.DesktopShell, fixture.Lifecycle.CtxOrBackground, fixture.Lifecycle.emitEvent, fixture.AppLogs.Logger())
	favorites := NewFavoritesService()
	uiState := NewUIStateStore()
	dataManagement := NewDataManagementCoordinator(DataManagementDependencies{
		Preferences: fixture.Preferences, Favorites: favorites, UIState: uiState,
		Updates: updates, Attention: fixture.Attention, ErrorReporting: errorReporting,
		AppLogs: fixture.AppLogs, DesktopShell: fixture.DesktopShell,
		RuntimeAvailable: fixture.Lifecycle.runtimeAvailable, Context: fixture.Lifecycle.CtxOrBackground,
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
	fixture.Lifecycle.preferences = fixture.Preferences
	fixture.Lifecycle.errorReporting = errorReporting
	fixture.Lifecycle.updates = updates
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
