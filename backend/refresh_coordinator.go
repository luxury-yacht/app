package backend

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
)

type refreshClusterRuntime interface {
	buildClusterClientsWithManager(context.Context, kubeconfigSelection, ClusterMeta, *authstate.Manager) (*clusterClients, error)
	buildNamespacesReadiness(*aggregateSnapshotService, string)
	clusterClientsForID(string) *clusterClients
	clusterClientsForSelection(kubeconfigSelection) *clusterClients
	clusterLifecycleState(string) ClusterLifecycleState
	clusterMetaForSelection(kubeconfigSelection) ClusterMeta
	clusterNameForID(string) string
	ensureClusterClientsForSelections(context.Context, []kubeconfigSelection) error
	replaceClusterClient(string, *clusterClients)
	replayClusterLifecycle(string)
	resourceDependenciesForSelection(kubeconfigSelection, *clusterClients, string) common.Dependencies
	runClusterOperation(context.Context, string, func(context.Context) error) error
	setClusterLifecycleState(string, ClusterLifecycleState)
	snapshotClusterIDs() []string
	startHeartbeatLoop(context.Context)
}

type refreshClusterWorkspace interface {
	markClusterWorkspaceChanged()
	setClusterHealth(string, ClusterHealthState)
}

type refreshAttention interface {
	RegisterTarget(string, attentionIgnoreRulesSetter)
	UnregisterTarget(string, attentionIgnoreRulesSetter)
	attentionIgnoreRulesForCluster(string) snapshot.AttentionIgnoreRules
	pruneClusterAttentionIgnoredObject(string, resourcemodel.ResourceRef) error
}

type refreshPreferences interface {
	cacheDirPath() (string, error)
}

// RefreshCoordinator is the sole state owner for refresh publication,
// per-cluster subsystems, streams, governor state, spill state, catalog
// runtimes, telemetry, and the process-wide container-log target limiter.
type RefreshCoordinator struct {
	clusterRuntime        refreshClusterRuntime
	clusterWorkspace      refreshClusterWorkspace
	attention             refreshAttention
	logger                *Logger
	allowedNamespaces     func(string) []string
	preferences           refreshPreferences
	containerLogsPolicy   *ContainerLogsSelectionPolicy
	permissionFetchPolicy *PermissionFetchPolicy
	resources             refreshResourceGateway
	context               func() context.Context
	runtimeAvailableFn    func() bool
	emitEventFn           func(string, ...interface{})
	refreshService        atomic.Pointer[refreshServiceHandler]

	refreshRuntimeMu      sync.Mutex
	refreshDone           <-chan struct{}
	refreshCancel         context.CancelFunc
	refreshRuntimeStopped bool
	telemetryMu           sync.RWMutex
	telemetryRecorder     *telemetry.Recorder
	resourceProjection    *refreshResourceProjection
	nodeMaintenanceStore  *nodemaintenance.Store
	metricsIntervalMu     sync.RWMutex
	metricsInterval       time.Duration

	containerLogsTargetLimiterMu sync.Mutex
	containerLogsTargetLimiter   *containerlogsstream.GlobalTargetLimiter

	refreshSubsystemsMu      sync.RWMutex
	refreshSubsystems        map[string]*system.Subsystem
	refreshAggregates        atomic.Pointer[refreshAggregateHandlers]
	refreshPermissionCancels map[string]context.CancelFunc

	governorReconcileMu sync.Mutex
	governorMu          sync.Mutex
	governorPolicy      system.GovernorPolicy
	governorMRU         []string
	governorVisible     string
	governorWindows     map[string]string
	governorPlanned     map[string]system.ResourceTier
	governorApplied     map[string]system.ResourceTier
	governorPressure    bool
	governorHeapInuse   uint64
	governorBudget      uint64
	governorNow         func() time.Time
	spillRoot           string
	spillFormat         string

	cooledMu          sync.Mutex
	cooledMmapClosers map[string][]func() error

	objectCatalogMu      sync.Mutex
	objectCatalogEntries map[string]*objectCatalogEntry
}

type refreshResourceGateway interface {
	clearCaches()
	objectDetailProvider() snapshot.ObjectDetailProvider
	registerResponseCacheInvalidation(*system.Subsystem, string)
}

type RefreshCoordinatorDependencies struct {
	ClusterRuntime        refreshClusterRuntime
	ClusterWorkspace      refreshClusterWorkspace
	Attention             refreshAttention
	Logger                *Logger
	AllowedNamespaces     func(string) []string
	Preferences           refreshPreferences
	ContainerLogsPolicy   *ContainerLogsSelectionPolicy
	PermissionFetchPolicy *PermissionFetchPolicy
	Resources             refreshResourceGateway
	Context               func() context.Context
	RuntimeAvailable      func() bool
	EmitEvent             func(string, ...interface{})
	ResourceProjection    *refreshResourceProjection
	NodeMaintenanceStore  *nodemaintenance.Store
	SettingsBridge        *refreshSettingBridge
}

func newRefreshCoordinator(dependencies RefreshCoordinatorDependencies) *RefreshCoordinator {
	requireRefreshCoordinatorDependencies(dependencies)
	coordinator := &RefreshCoordinator{
		clusterRuntime:           dependencies.ClusterRuntime,
		clusterWorkspace:         dependencies.ClusterWorkspace,
		attention:                dependencies.Attention,
		logger:                   dependencies.Logger,
		allowedNamespaces:        dependencies.AllowedNamespaces,
		preferences:              dependencies.Preferences,
		containerLogsPolicy:      dependencies.ContainerLogsPolicy,
		permissionFetchPolicy:    dependencies.PermissionFetchPolicy,
		resources:                dependencies.Resources,
		context:                  dependencies.Context,
		runtimeAvailableFn:       dependencies.RuntimeAvailable,
		emitEventFn:              dependencies.EmitEvent,
		refreshSubsystems:        make(map[string]*system.Subsystem),
		refreshPermissionCancels: make(map[string]context.CancelFunc),
		objectCatalogEntries:     make(map[string]*objectCatalogEntry),
		resourceProjection:       dependencies.ResourceProjection,
		nodeMaintenanceStore:     dependencies.NodeMaintenanceStore,
		metricsInterval:          time.Duration(defaultMetricsIntervalMs()) * time.Millisecond,
	}
	dependencies.SettingsBridge.bind(coordinator)
	return coordinator
}

func requireRefreshCoordinatorDependencies(dependencies RefreshCoordinatorDependencies) {
	switch {
	case dependencies.ClusterRuntime == nil:
		panic("newRefreshCoordinator: ClusterRuntime is required")
	case dependencies.ClusterWorkspace == nil:
		panic("newRefreshCoordinator: ClusterWorkspace is required")
	case dependencies.Attention == nil:
		panic("newRefreshCoordinator: Attention is required")
	case dependencies.Logger == nil:
		panic("newRefreshCoordinator: Logger is required")
	case dependencies.AllowedNamespaces == nil:
		panic("newRefreshCoordinator: AllowedNamespaces is required")
	case dependencies.Preferences == nil:
		panic("newRefreshCoordinator: Preferences is required")
	case dependencies.ContainerLogsPolicy == nil:
		panic("newRefreshCoordinator: ContainerLogsPolicy is required")
	case dependencies.PermissionFetchPolicy == nil:
		panic("newRefreshCoordinator: PermissionFetchPolicy is required")
	case dependencies.Resources == nil:
		panic("newRefreshCoordinator: Resources is required")
	case dependencies.Context == nil:
		panic("newRefreshCoordinator: Context is required")
	case dependencies.RuntimeAvailable == nil:
		panic("newRefreshCoordinator: RuntimeAvailable is required")
	case dependencies.EmitEvent == nil:
		panic("newRefreshCoordinator: EmitEvent is required")
	case dependencies.ResourceProjection == nil:
		panic("newRefreshCoordinator: ResourceProjection is required")
	case dependencies.NodeMaintenanceStore == nil:
		panic("newRefreshCoordinator: NodeMaintenanceStore is required")
	case dependencies.SettingsBridge == nil:
		panic("newRefreshCoordinator: SettingsBridge is required")
	}
}

func (r *RefreshCoordinator) currentTelemetryRecorder() *telemetry.Recorder {
	if r == nil {
		return nil
	}
	r.telemetryMu.RLock()
	defer r.telemetryMu.RUnlock()
	return r.telemetryRecorder
}

func (r *RefreshCoordinator) setTelemetryRecorder(recorder *telemetry.Recorder) {
	if r == nil {
		return
	}
	r.telemetryMu.Lock()
	r.telemetryRecorder = recorder
	r.telemetryMu.Unlock()
	r.resourceProjection.publishTelemetry(recorder)
}

func (r *RefreshCoordinator) CtxOrBackground() context.Context {
	if r == nil || r.context == nil {
		return context.Background()
	}
	if ctx := r.context(); ctx != nil {
		return ctx
	}
	return context.Background()
}

func (r *RefreshCoordinator) runtimeAvailable() bool {
	return r != nil && r.runtimeAvailableFn != nil && r.runtimeAvailableFn()
}

func (r *RefreshCoordinator) refreshAllowedNamespaces(clusterID string) []string {
	if r == nil || r.allowedNamespaces == nil {
		return nil
	}
	return r.allowedNamespaces(clusterID)
}
