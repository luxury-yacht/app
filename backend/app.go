package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/internal/panelwindow"
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
	NodeMaintenance       *nodemaintenance.Store
	DataManagement        *DataManagementCoordinator
	Attention             *ClusterAttentionService
	Resources             *ResourceGateway
	Operations            *OperationsCoordinator
	Updates               *UpdateCoordinator
}

// ApplicationRuntimeOptions contains composition-time dependencies that are
// known only by the process entry point. Owners receive them before their
// constructors return; the runtime is never configured afterward.
type ApplicationRuntimeOptions struct {
	Reporter                   sentryreporting.Reporter
	ApplicationUpdates         ApplicationUpdateOptions
	CreateWorkspaceWindow      func()
	IsWorkspaceWindow          func(string) bool
	NativeWindowDescriptor     func(string) (panelwindow.NativeDescriptor, error)
	BeginPanelWindowOpen       func(panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error)
	AcknowledgePanelReady      func(string, string) (panelwindow.WindowDescriptor, error)
	BeginPanelWindowDock       func(string, string, panelwindow.GroupSnapshot) error
	AcknowledgePanelDock       func(string, string, string) error
	FailPanelTransfer          func(string, string, string) error
	FocusPanelWindow           func(string, string, string) error
	RequestPanelClose          func(string, string, string) error
	AcknowledgePanelClose      func(string) error
	RequestClusterPanelsClose  func(string, string) error
	AcknowledgeWorkspaceClose  func(string) error
	RoutePanelCommand          func(string, string) error
	RequestPanelObjectOpen     func(string, panelwindow.ObjectReference, string) error
	AuthorizePanelObjectOpen   func(string, string, string, panelwindow.ObjectReference, string) error
	UpdatePanelSnapshot        func(string, panelwindow.GroupSnapshot) error
	RequestPanelTabClose       func(string, string) error
	AuthorizePanelTabClose     func(string, string, string) error
	RequestPanelGuard          func(string, string, string, string) error
	AcknowledgePanelGuard      func(string, string, bool) error
	AcknowledgeApplicationQuit func(string, string, bool) error
}

// NewApplicationRuntime composes focused backend owners around the concrete
// Wails application without retaining behavior on the composition result.
func NewApplicationRuntime(wailsApplication *application.App, configured ...ApplicationRuntimeOptions) *ApplicationRuntime {
	if len(configured) > 1 {
		panic("application runtime accepts at most one options value")
	}
	var options ApplicationRuntimeOptions
	if len(configured) == 1 {
		options = configured[0]
	}
	isWorkspaceWindow := options.IsWorkspaceWindow
	if isWorkspaceWindow == nil {
		isWorkspaceWindow = func(string) bool { return true }
	}
	var reporters []sentryreporting.Reporter
	if options.Reporter != nil {
		reporters = append(reporters, options.Reporter)
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
	updateCheck := &updateCheckPort{}
	kubeconfigSearchPaths := &kubeconfigSearchPathPort{}
	desktopShell := NewDesktopShell(
		wailsApplication, signals.runtimeAvailable, signals.emitEvent, appLogs.Logger(),
		DesktopShellBindings{
			UpdateCheck: updateCheck.check, KubeconfigSearchPaths: kubeconfigSearchPaths.read,
			CreateWorkspaceWindow:      options.CreateWorkspaceWindow,
			NativeWindowDescriptor:     options.NativeWindowDescriptor,
			BeginPanelWindowOpen:       options.BeginPanelWindowOpen,
			AcknowledgePanelReady:      options.AcknowledgePanelReady,
			BeginPanelWindowDock:       options.BeginPanelWindowDock,
			AcknowledgePanelDock:       options.AcknowledgePanelDock,
			FailPanelTransfer:          options.FailPanelTransfer,
			FocusPanelWindow:           options.FocusPanelWindow,
			RequestPanelClose:          options.RequestPanelClose,
			AcknowledgePanelClose:      options.AcknowledgePanelClose,
			RequestClusterPanelsClose:  options.RequestClusterPanelsClose,
			AcknowledgeWorkspaceClose:  options.AcknowledgeWorkspaceClose,
			RoutePanelCommand:          options.RoutePanelCommand,
			RequestPanelObjectOpen:     options.RequestPanelObjectOpen,
			AuthorizePanelObjectOpen:   options.AuthorizePanelObjectOpen,
			UpdatePanelSnapshot:        options.UpdatePanelSnapshot,
			RequestPanelTabClose:       options.RequestPanelTabClose,
			AuthorizePanelTabClose:     options.AuthorizePanelTabClose,
			RequestPanelGuard:          options.RequestPanelGuard,
			AcknowledgePanelGuard:      options.AcknowledgePanelGuard,
			AcknowledgeApplicationQuit: options.AcknowledgeApplicationQuit,
		},
	)
	updates := NewUpdateCoordinator(
		desktopShell, signals.CtxOrBackground, signals.emitEvent, appLogs.Logger(),
		options.ApplicationUpdates, updateCheck,
	)
	installationTelemetry := &installationTelemetryPort{}
	errorReporting := NewErrorReportingService(options.Reporter, signals.CtxOrBackground, appLogs.Logger(), installationTelemetry)
	refreshSettings := newRefreshSettingBridge(
		defaultObjPanelLogsTargetGlobalLimit,
		defaultMetricsIntervalMs(),
	)
	clusterRateLimits := newClusterRateLimitBridge(defaultKubernetesClientQPS, defaultKubernetesClientBurst)
	preferences := NewPreferencesService(
		desktopShell,
		NewSettingsEffectDispatcher(errorReporting, clusterRateLimits, permissionFetchPolicy, containerLogsPolicy, refreshSettings, appLogs.Logger()),
		appLogs.Logger(),
		kubeconfigSearchPaths,
		installationTelemetry,
	)
	clusterRuntime := newClusterRuntimeManager(ClusterRuntimeManagerDependencies{
		DiscoveryRepository: preferences, Logger: appLogs.Logger(), ContainerLogsPolicy: containerLogsPolicy,
		Projection: clusterWorkspace, EmitEvent: signals.emitEvent, Context: signals.CtxOrBackground,
		RateLimitsBridge: clusterRateLimits,
	})
	attention := NewClusterAttentionService(preferences, appLogs.Logger())
	resourceProjection := newRefreshResourceProjection()
	nodeMaintenanceStore := nodemaintenance.NewStore(5)
	operations := newApplicationOperationsCoordinator(
		clusterRuntime, resourceProjection, nodeMaintenanceStore,
		signals.CtxOrBackground, signals.emitEvent, appLogs.Logger(),
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
		nodeMaintenanceStore:         nodeMaintenanceStore,
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
		Context:          signals.CtxOrBackground,
		RuntimeAvailable: signals.runtimeAvailable, EmitEvent: signals.emitEvent,
		ResourceProjection:   resourceProjection,
		NodeMaintenanceStore: nodeMaintenanceStore,
		SettingsBridge:       refreshSettings,
	})
	workspace := newWorkspaceCoordinator(WorkspaceCoordinatorDependencies{
		ClusterRuntime: clusterRuntime, ClusterWorkspace: clusterWorkspace, Refresh: refresh,
		Preferences: preferences, Operations: operations, Logger: appLogs.Logger(),
		Context: signals.CtxOrBackground, RuntimeAvailable: signals.runtimeAvailable, EmitEvent: signals.emitEvent,
		IsWorkspaceWindow: isWorkspaceWindow,
	})
	favorites := NewFavoritesService()
	uiState := NewUIStateStore()
	staticState := newStaticAppStateCleaner("luxury-yacht")
	dataManagement := NewDataManagementCoordinator(DataManagementDependencies{
		Preferences: preferences, Favorites: favorites, UIState: uiState,
		Updates: updates, StaticState: staticState,
		Attention: attention, ErrorReporting: errorReporting,
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
		DesktopShell: desktopShell, Logger: appLogs.Logger(), StartupState: staticState, Preferences: preferences,
		ErrorReporting: errorReporting, ClusterRuntime: clusterRuntime, Refresh: refresh,
		Workspace: workspace, Operations: operations, Updates: updates,
	})
	refresh.initGovernor()

	return &ApplicationRuntime{
		Lifecycle: lifecycle, ClusterRuntime: clusterRuntime, ClusterWorkspace: clusterWorkspace,
		Refresh: refresh, Workspace: workspace, DesktopShell: desktopShell, AppLogs: appLogs,
		Favorites: favorites, UIState: uiState, Preferences: preferences,
		ErrorReporting: errorReporting, ContainerLogsPolicy: containerLogsPolicy,
		PermissionFetchPolicy: permissionFetchPolicy, NodeMaintenance: nodeMaintenanceStore,
		DataManagement: dataManagement,
		Attention:      attention, Resources: resources, Operations: operations, Updates: updates,
	}
}
