package backend

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	RefreshResourceStreamName      = "refresh-resources"
	RefreshContainerLogsStreamName = "refresh-container-logs"
)

// App provides the backend implementation composed behind DesktopService.
type App struct {
	*ClusterRuntimeManager
	*ClusterWorkspaceProjection
	*RefreshCoordinator
	*WorkspaceCoordinator

	appDone               <-chan struct{}
	runtimeReady          atomic.Bool
	desktopShell          *DesktopShell
	appLogs               *AppLogService
	favorites             *FavoritesService
	uiState               *UIStateStore
	preferences           *PreferencesService
	errorReporting        *ErrorReportingService
	containerLogsPolicy   *ContainerLogsSelectionPolicy
	permissionFetchPolicy *PermissionFetchPolicy
	dataManagement        *DataManagementCoordinator
	attention             *ClusterAttentionService
	resources             *ResourceGateway

	preQuitOnce sync.Once

	operations *OperationsCoordinator

	updates *UpdateCoordinator

	eventEmitter func(context.Context, string, ...interface{})
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

// NewApp constructs a backend App with its Wails application and sane defaults.
func NewApp(wailsApplication *application.App, reporters ...sentryreporting.Reporter) *App {
	var reporter sentryreporting.Reporter
	if len(reporters) > 0 {
		reporter = reporters[0]
	}
	app := &App{
		ClusterRuntimeManager:      newClusterRuntimeManager(),
		ClusterWorkspaceProjection: newClusterWorkspaceProjection(),
		RefreshCoordinator:         newRefreshCoordinator(),
		WorkspaceCoordinator:       newWorkspaceCoordinator(),
		appLogs:                    NewAppLogService(NewLogger(1000, reporters...)),
		favorites:                  NewFavoritesService(),
		uiState:                    NewUIStateStore(),
		containerLogsPolicy:        NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit),
		permissionFetchPolicy:      NewPermissionFetchPolicy(defaultPermissionSSRRFetchConcurrency),
		eventEmitter: func(_ context.Context, name string, data ...interface{}) {
			if wailsApplication != nil {
				wailsApplication.Event.Emit(name, data...)
			}
		},
	}
	app.desktopShell = NewDesktopShell(wailsApplication, app.runtimeAvailable, app.emitEvent, app.appLogs.Logger())
	app.updates = NewUpdateCoordinator(app.desktopShell, app.CtxOrBackground, app.emitEvent, app.appLogs.Logger())
	app.desktopShell.ConfigureUpdateCheck(func() error {
		_, err := app.updates.CheckForUpdates()
		return err
	})
	app.errorReporting = NewErrorReportingService(reporter, app.CtxOrBackground, app.appLogs.Logger())
	app.preferences = NewPreferencesService(
		app.desktopShell,
		NewSettingsEffectDispatcher(app.errorReporting, app.ClusterRuntimeManager, app.permissionFetchPolicy, app.containerLogsPolicy, app.RefreshCoordinator, app.appLogs.Logger()),
		app.appLogs.Logger(),
	)
	app.ClusterRuntimeManager.discoveryRepository = app.preferences
	app.ClusterRuntimeManager.logger = app.appLogs.Logger()
	app.ClusterRuntimeManager.containerLogsPolicy = app.containerLogsPolicy
	app.ClusterRuntimeManager.projection = app.ClusterWorkspaceProjection
	app.ClusterRuntimeManager.emitEvent = app.emitEvent
	app.ClusterRuntimeManager.context = app.CtxOrBackground
	app.desktopShell.ConfigureKubeconfigSearchPaths(app.preferences.KubeconfigSearchPaths)
	app.attention = NewClusterAttentionService(app.preferences, app.appLogs.Logger())
	app.RefreshCoordinator.ClusterRuntimeManager = app.ClusterRuntimeManager
	app.RefreshCoordinator.ClusterWorkspaceProjection = app.ClusterWorkspaceProjection
	app.RefreshCoordinator.attention = app.attention
	app.RefreshCoordinator.logger = app.appLogs.Logger()
	app.RefreshCoordinator.preferences = app.preferences
	app.RefreshCoordinator.containerLogsPolicy = app.containerLogsPolicy
	app.RefreshCoordinator.permissionFetchPolicy = app.permissionFetchPolicy
	app.RefreshCoordinator.appLogs = app.appLogs
	app.RefreshCoordinator.context = app.CtxOrBackground
	app.RefreshCoordinator.runtimeAvailableFn = app.runtimeAvailable
	app.RefreshCoordinator.emitEventFn = app.emitEvent
	app.RefreshCoordinator.allowedNamespaces = func(clusterID string) []string {
		namespaces, err := app.preferences.clusterAllowedNamespaces(clusterID)
		if err != nil {
			app.appLogs.Logger().Warn(fmt.Sprintf("Could not read allowed namespaces for cluster %s (running cluster-wide): %v", clusterID, err), "Settings", clusterID, clusterID)
			return nil
		}
		return namespaces
	}
	app.errorReporting.ConfigureInstallationTelemetry(app.preferences)
	app.setupEnvironment()
	app.initGovernor()
	app.initializeOperationsCoordinator()
	app.resources = newResourceGateway(resourceGatewayDependencies{
		resolveClusterDependencies:       app.ClusterRuntimeManager.resolveClusterDependencies,
		resourceDependenciesForClusterID: app.ClusterRuntimeManager.resourceDependenciesForClusterID,
		context:                          app.CtxOrBackground,
		emitEvent:                        app.emitEvent,
		logger:                           app.appLogs.Logger(),
		clusterName:                      app.ClusterRuntimeManager.clusterNameForID,
		recordTransportSuccess:           app.ClusterRuntimeManager.recordClusterTransportSuccess,
		recordTransportFailure:           app.ClusterRuntimeManager.recordClusterTransportFailure,
		resourceResolverForCluster: func(clusterID string) common.ResourceResolver {
			return clusterRuntimeResourceResolver{
				runtime:        app.ClusterRuntimeManager,
				clusterID:      clusterID,
				catalogService: app.RefreshCoordinator.resourceProjection.objectCatalogServiceForCluster,
			}
		},
		refreshProjection:            app.RefreshCoordinator.resourceProjection,
		permissionFetchPolicy:        app.permissionFetchPolicy,
		containerLogsSelectionPolicy: app.containerLogsPolicy,
		operations:                   app.operations,
	})
	app.RefreshCoordinator.resources = app.resources
	app.WorkspaceCoordinator.ClusterRuntimeManager = app.ClusterRuntimeManager
	app.WorkspaceCoordinator.ClusterWorkspaceProjection = app.ClusterWorkspaceProjection
	app.WorkspaceCoordinator.RefreshCoordinator = app.RefreshCoordinator
	app.WorkspaceCoordinator.preferences = app.preferences
	app.WorkspaceCoordinator.operations = app.operations
	app.WorkspaceCoordinator.resources = app.resources
	app.WorkspaceCoordinator.appLogs = app.appLogs
	app.WorkspaceCoordinator.context = app.CtxOrBackground
	app.WorkspaceCoordinator.runtimeAvailableFn = app.runtimeAvailable
	app.WorkspaceCoordinator.emitEventFn = app.emitEvent
	app.WorkspaceCoordinator.kubeClientInitializer = app.WorkspaceCoordinator.initKubernetesClient
	workspace := app.WorkspaceCoordinator
	refreshCoordinator := app.RefreshCoordinator
	app.dataManagement = NewDataManagementCoordinator(DataManagementDependencies{
		Preferences: app.preferences, Favorites: app.favorites, UIState: app.uiState,
		Updates: app.updates, Attention: app.attention, ErrorReporting: app.errorReporting,
		AppLogs: app.appLogs, DesktopShell: app.desktopShell,
		RuntimeAvailable: app.runtimeAvailable, Context: app.CtxOrBackground,
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
	return app
}

func (a *App) FavoritesService() *FavoritesService { return a.favorites }

func (a *App) UIStateStore() *UIStateStore { return a.uiState }

func (a *App) AppLogService() *AppLogService { return a.appLogs }

func (a *App) DesktopShell() *DesktopShell { return a.desktopShell }

func (a *App) PreferencesService() *PreferencesService { return a.preferences }

func (a *App) ErrorReportingService() *ErrorReportingService { return a.errorReporting }

func (a *App) DataManagementCoordinator() *DataManagementCoordinator { return a.dataManagement }

func (a *App) ClusterAttentionService() *ClusterAttentionService { return a.attention }

func (a *App) UpdateCoordinator() *UpdateCoordinator { return a.updates }

func (a *App) ResourceGateway() *ResourceGateway { return a.resources }

func (a *App) emitEvent(name string, args ...interface{}) {
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
