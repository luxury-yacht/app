package backend

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/internal/appupdates"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/wailsapp/wails/v3/pkg/application"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	informers "k8s.io/client-go/informers"
)

const (
	RefreshResourceStreamName      = "refresh-resources"
	RefreshContainerLogsStreamName = "refresh-container-logs"
)

// App provides the backend implementation composed behind DesktopService.
type App struct {
	appDone                  <-chan struct{}
	runtimeReady             atomic.Bool
	desktopShell             *DesktopShell
	selectedKubeconfigs      []string
	availableKubeconfigs     []KubeconfigInfo
	kubeconfigDiscoveryState KubeconfigDiscoveryState
	appLogs                  *AppLogService
	favorites                *FavoritesService
	uiState                  *UIStateStore
	preferences              *PreferencesService
	errorReporting           *ErrorReportingService
	containerLogsPolicy      *ContainerLogsSelectionPolicy
	permissionFetchPolicy    *PermissionFetchPolicy
	dataManagement           *DataManagementCoordinator
	attention                *ClusterAttentionService
	resources                *ResourceGateway

	refreshManager *refresh.Manager
	refreshService atomic.Pointer[refreshServiceHandler]
	// refreshRuntimeMu owns refreshDone and refreshCancel. Selection mutations and
	// governor reconciliation use different lifecycle locks, so neither is a
	// substitute for this process-runtime boundary.
	refreshRuntimeMu sync.Mutex
	refreshDone      <-chan struct{}
	refreshCancel    context.CancelFunc
	// refreshRuntimeStopped distinguishes a deliberate global teardown from the
	// never-started state that auth recovery is allowed to initialise.
	refreshRuntimeStopped bool
	telemetryRecorder     *telemetry.Recorder
	// containerLogsTargetLimiter is lazily built by sharedContainerLogsTargetLimiter;
	// its mutex guards the check-then-set because subsystem builds run concurrently
	// per cluster. Access the limiter only through the accessor. The mutex is a LEAF
	// lock: never lock anything else (settingsMu especially) or load settings while
	// holding it — the settings paths call the accessor, some under settingsMu.
	containerLogsTargetLimiterMu sync.Mutex
	containerLogsTargetLimiter   *containerlogsstream.GlobalTargetLimiter
	sharedInformerFactory        informers.SharedInformerFactory
	apiExtensionsInformerFactory apiextinformers.SharedInformerFactory
	refreshSubsystemsMu          sync.RWMutex
	refreshSubsystems            map[string]*system.Subsystem
	refreshAggregates            atomic.Pointer[refreshAggregateHandlers]
	refreshPermissionCancels     map[string]context.CancelFunc

	// governor holds the process-wide resource governor state: which open
	// clusters run Foreground/Background/Cold so RAM stays bounded when many
	// clusters are open. All fields are guarded by governorMu.
	// governorReconcileMu serializes slow tier applications without preventing
	// callers from recording a newer visible cluster under governorMu. The next
	// reconcile then observes that newer intent after the in-flight transition
	// has reached a real, internally consistent subsystem state.
	governorReconcileMu sync.Mutex
	governorMu          sync.Mutex
	governorPolicy      system.GovernorPolicy
	governorMRU         []string                       // open cluster IDs, most-recently-visible first
	governorVisible     string                         // compatibility demand used before a window identifies itself
	governorWindows     map[string]string              // visible cluster by peer workspace window
	governorPlanned     map[string]system.ResourceTier // latest tier plan published before lifecycle work starts
	governorApplied     map[string]system.ResourceTier // last-applied tier per cluster
	governorPressure    bool                           // memory-pressure signal (HeapInuse over budget)
	governorHeapInuse   uint64                         // latest sampled HeapInuse, for pressure diagnostics
	governorBudget      uint64                         // HeapInuse byte budget; 0 disables pressure demotion
	governorNow         func() time.Time               // clock for bounded pressure fallback; time.Now in production
	spillRoot           string                         // override for the maintained-store spill root; empty = user cache dir (tests set a temp dir)
	spillFormat         string                         // override for the spill format version; empty = app Version (tests set a fixed value)

	// cooledMmapClosers holds, per cooled cluster, the mmap closers returned by
	// CoolMaintainedStoresToMmap. Each closer unmaps one domain's cooled column file and MUST
	// outlive every Build that can read it; the re-warm/teardown paths take them (exactly once,
	// under cooledMu) and call them only AFTER the cooled subsystem is unrouted, so no Build can
	// still be reading the mapping. Guarded by cooledMu, independent of governorMu so closing
	// never blocks the governor decision loop.
	cooledMu          sync.Mutex
	cooledMmapClosers map[string][]func() error

	objectCatalogMu      sync.Mutex
	objectCatalogEntries map[string]*objectCatalogEntry

	// kubeconfigsMu guards kubeconfig discovery data and selected kubeconfig reads/writes.
	kubeconfigsMu sync.RWMutex
	// selectionMutationMu serializes coordinated cluster runtime mutations.
	// This preserves sequential behavior while allowing kubeconfigChangeMu to stay
	// narrowly scoped to short state-transition sections.
	selectionMutationMu sync.Mutex
	// workspaceSelections is the complete tab selection owned by each peer
	// window. It is guarded by selectionMutationMu; selectedKubeconfigs is the
	// process-wide union that owns shared cluster clients and refresh lifecycles.
	workspaceSelections map[string][]string
	// selectionMutationDrain tracks queued and active selection mutations so app
	// shutdown can wait for durable selection writes, not just active runtime work.
	selectionMutationDrainMu   sync.Mutex
	selectionMutationDrainCond *sync.Cond
	selectionMutationPending   int
	preQuitOnce                sync.Once
	// kubeconfigChangeMu serializes runtime cluster/subsystem mutation paths.
	// Lock ordering for runtime cluster mutation paths:
	//   1) selectionMutationMu
	//   2) kubeconfigChangeMu
	//   3) clusterClientsMu
	//   4) objectCatalogMu
	// Keep this ordering consistent to avoid deadlocks.
	kubeconfigChangeMu sync.Mutex
	// selectionGeneration is a monotonic token incremented for each coordinated
	// runtime mutation touching cluster selection/subsystem state.
	selectionGeneration atomic.Uint64
	selectionGenCtxMu   sync.Mutex
	selectionGenCancel  context.CancelFunc
	selectionDiag       selectionDiagnosticsState
	// requestClusterScopeRebuildFn overrides the per-cluster rebuild request
	// issued when a cluster's allowed-namespaces scope changes (tests inject a
	// recorder). Nil selects the production teardown+rebuild path.
	requestClusterScopeRebuildFn func(clusterID string)
	// scopeRebuildQueued tracks clusters with a scope rebuild queued but not
	// yet started, so rapid successive scope edits coalesce into one rebuild
	// that reads the latest persisted scope.
	scopeRebuildQueued sync.Map

	clusterClientsMu sync.Mutex
	clusterClients   map[string]*clusterClients
	clusterOps       *clusterOperationCoordinator
	clusterLifecycle *clusterLifecycle
	kubeAPIMetrics   *kubernetesAPIMetricsRegistry

	operations *OperationsCoordinator

	updates *UpdateCoordinator

	// Per-cluster auth recovery scheduling.
	// Tracks auth recovery scheduling per-cluster, allowing isolated
	// recovery scheduling without affecting other clusters.

	// Per-cluster transport failure tracking.
	// Tracks transport failures per-cluster, allowing isolated
	// recovery without affecting other clusters.
	transportStatesMu sync.RWMutex
	transportStates   map[string]*transportFailureState

	// clusterWorkspaceMu guards replayable health and namespace-scope state.
	clusterWorkspaceMu       sync.RWMutex
	clusterWorkspaceRevision atomic.Uint64
	clusterHealth            map[string]ClusterHealthState
	clusterScopeRevisions    map[string]uint64

	kubeconfigWatcher *kubeconfigWatcher

	eventEmitter          func(context.Context, string, ...interface{})
	kubeClientInitializer func() error
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
		appLogs:                  NewAppLogService(NewLogger(1000, reporters...)),
		favorites:                NewFavoritesService(),
		uiState:                  NewUIStateStore(),
		containerLogsPolicy:      NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit),
		permissionFetchPolicy:    NewPermissionFetchPolicy(defaultPermissionSSRRFetchConcurrency),
		refreshSubsystems:        make(map[string]*system.Subsystem),
		refreshPermissionCancels: make(map[string]context.CancelFunc),
		clusterClients:           make(map[string]*clusterClients),
		clusterOps:               newClusterOperationCoordinator(),
		kubeAPIMetrics:           newKubernetesAPIMetricsRegistry(),
		objectCatalogEntries:     make(map[string]*objectCatalogEntry),
		eventEmitter: func(_ context.Context, name string, data ...interface{}) {
			if wailsApplication != nil {
				wailsApplication.Event.Emit(name, data...)
			}
		},
		clusterHealth:         make(map[string]ClusterHealthState),
		clusterScopeRevisions: make(map[string]uint64),
		workspaceSelections:   make(map[string][]string),
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
		NewSettingsEffectDispatcher(app.errorReporting, app, app.permissionFetchPolicy, app.containerLogsPolicy, app, app.appLogs.Logger()),
		app.appLogs.Logger(),
	)
	app.desktopShell.ConfigureKubeconfigSearchPaths(app.preferences.KubeconfigSearchPaths)
	app.attention = NewClusterAttentionService(app.preferences, app.appLogs.Logger())
	app.errorReporting.ConfigureInstallationTelemetry(app.preferences)
	app.dataManagement = NewDataManagementCoordinator(DataManagementDependencies{
		Preferences: app.preferences, Favorites: app.favorites, UIState: app.uiState,
		Updates: app.updates, Attention: app.attention, ErrorReporting: app.errorReporting,
		AppLogs: app.appLogs, DesktopShell: app.desktopShell,
		RuntimeAvailable: app.runtimeAvailable, Context: app.CtxOrBackground,
		WorkspaceMutation: func(name string, action func() error) error {
			return app.runSelectionMutation(name, func(_ *selectionMutation) error { return action() })
		},
		ResetRuntime: func() error {
			if err := app.clearKubeconfigSelection(); err != nil {
				return err
			}
			if app.resources != nil {
				app.resources.clearCaches()
			}
			return nil
		},
		SearchPathsChanged: app.refreshKubeconfigDiscoveryAfterSearchPathChange,
	})
	app.kubeClientInitializer = func() error {
		return app.initKubernetesClient()
	}
	app.setupEnvironment()
	app.initAuthManager()
	app.initGovernor()
	app.initializeOperationsCoordinator()
	app.resources = newResourceGateway(resourceGatewayDependencies{
		resolveClusterDependencies:       app.resolveClusterDependencies,
		resourceDependenciesForClusterID: app.resourceDependenciesForClusterID,
		context:                          app.CtxOrBackground,
		emitEvent:                        app.emitEvent,
		logger:                           app.appLogs.Logger(),
		clusterName:                      app.clusterNameForID,
		recordTransportSuccess:           app.recordClusterTransportSuccess,
		recordTransportFailure:           app.recordClusterTransportFailure,
		retryTelemetry: func() resourceRetryTelemetry {
			if app.telemetryRecorder == nil {
				return nil
			}
			return app.telemetryRecorder
		},
		catalogServiceForCluster: app.objectCatalogServiceForCluster,
		resourceResolverForCluster: func(clusterID string) common.ResourceResolver {
			return resourceGatewayCatalogResolver{clusterID: clusterID, lookup: app.objectCatalogServiceForCluster}
		},
		catalogEntries: app.snapshotObjectCatalogEntries,
		catalogTelemetry: func() telemetry.Summarizer {
			if app.telemetryRecorder == nil {
				return nil
			}
			return app.telemetryRecorder
		},
		permissionFetchPolicy:        app.permissionFetchPolicy,
		containerLogsSelectionPolicy: app.containerLogsPolicy,
		operations:                   app.operations,
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

// initAuthManager is kept for backwards compatibility but is now a no-op.
// Auth state management is now per-cluster, handled by each cluster's authManager
// in the clusterClients struct. See cluster_auth.go for details.
func (a *App) initAuthManager() {
	// Per-cluster auth managers are created in buildClusterClients().
	// This function is kept for compatibility but does nothing.
}

// RetryAuth triggers a manual authentication recovery attempt for ALL clusters.
// Called when user clicks "Retry" after re-authenticating externally.
// For per-cluster retry, use RetryClusterAuth instead.
func (a *App) RetryAuth() {
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()

	for _, clients := range a.clusterClients {
		if clients != nil && clients.authManager != nil {
			clients.authManager.TriggerRetry()
		}
	}
}
