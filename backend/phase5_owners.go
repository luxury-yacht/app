package backend

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// ClusterWorkspaceProjection is the leaf owner of replayable per-cluster
// health and namespace-scope revision state. Source owners write through its
// narrow methods; it never owns clients, selections, or refresh subsystems.
type ClusterWorkspaceProjection struct {
	clusterWorkspaceMu       sync.RWMutex
	clusterWorkspaceRevision atomic.Uint64
	clusterHealth            map[string]ClusterHealthState
	clusterScopeRevisions    map[string]uint64
}

func newClusterWorkspaceProjection() *ClusterWorkspaceProjection {
	return &ClusterWorkspaceProjection{
		clusterHealth:         make(map[string]ClusterHealthState),
		clusterScopeRevisions: make(map[string]uint64),
	}
}

// ClusterRuntimeManager is the sole state owner for Kubernetes cluster
// discovery, clients, authentication, lifecycle, transport health, and API
// metrics. Cross-owner work is published as typed intents rather than through
// an application back-pointer.
type ClusterRuntimeManager struct {
	discoveryMu              sync.RWMutex
	availableKubeconfigs     []KubeconfigInfo
	kubeconfigDiscoveryState KubeconfigDiscoveryState
	kubeconfigWatcher        *kubeconfigWatcher
	discoveryRepository      kubeconfigDiscoveryRepository
	logger                   *Logger
	containerLogsPolicy      *ContainerLogsSelectionPolicy
	projection               *ClusterWorkspaceProjection
	emitEvent                func(string, ...interface{})
	context                  func() context.Context

	clusterClientsMu sync.Mutex
	clusterClients   map[string]*clusterClients
	clusterOps       *clusterOperationCoordinator
	clusterLifecycle *clusterLifecycle
	kubeAPIMetrics   *kubernetesAPIMetricsRegistry
	rateLimitMu      sync.RWMutex
	kubernetesQPS    int
	kubernetesBurst  int

	transportStatesMu sync.RWMutex
	transportStates   map[string]*transportFailureState

	intents          *clusterRuntimeIntentQueue
	intentGeneration atomic.Uint64
}

type kubeconfigDiscoveryRepository interface {
	KubeconfigSearchPaths() ([]string, error)
	SetDiscoveredKubeconfigSearchPaths([]string)
	DiscoveredKubeconfigSearchPaths() []string
}

func newClusterRuntimeManager() *ClusterRuntimeManager {
	return &ClusterRuntimeManager{
		clusterClients:  make(map[string]*clusterClients),
		clusterOps:      newClusterOperationCoordinator(),
		kubeAPIMetrics:  newKubernetesAPIMetricsRegistry(),
		kubernetesQPS:   defaultKubernetesClientQPS,
		kubernetesBurst: defaultKubernetesClientBurst,
		intents:         newClusterRuntimeIntentQueue(),
	}
}

func (m *ClusterRuntimeManager) stopIntentConsumption() {
	if m != nil && m.intents != nil {
		m.intents.Stop()
	}
}

func (m *ClusterRuntimeManager) stopAuthRecovery() {
	if m == nil {
		return
	}
	m.clusterClientsMu.Lock()
	clients := make([]*clusterClients, 0, len(m.clusterClients))
	for _, item := range m.clusterClients {
		clients = append(clients, item)
	}
	m.clusterClientsMu.Unlock()
	for _, item := range clients {
		if item != nil && item.authManager != nil {
			item.authManager.Shutdown()
		}
	}
}

// RefreshCoordinator is the sole state owner for refresh publication,
// per-cluster subsystems, streams, governor state, spill state, catalog
// runtimes, telemetry, and the process-wide container-log target limiter.
type RefreshCoordinator struct {
	*ClusterRuntimeManager
	*ClusterWorkspaceProjection
	attention             *ClusterAttentionService
	logger                *Logger
	allowedNamespaces     func(string) []string
	preferences           *PreferencesService
	containerLogsPolicy   *ContainerLogsSelectionPolicy
	permissionFetchPolicy *PermissionFetchPolicy
	resources             *ResourceGateway
	appLogs               *AppLogService
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

func newRefreshCoordinator() *RefreshCoordinator {
	return &RefreshCoordinator{
		refreshSubsystems:        make(map[string]*system.Subsystem),
		refreshPermissionCancels: make(map[string]context.CancelFunc),
		objectCatalogEntries:     make(map[string]*objectCatalogEntry),
		resourceProjection:       newRefreshResourceProjection(),
		metricsInterval:          time.Duration(defaultMetricsIntervalMs()) * time.Millisecond,
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

// WorkspaceCoordinator is the sole state owner for peer-window selections,
// serialized selection mutations, supersession generations, selection
// diagnostics, and namespace-scope rebuild coalescing.
type WorkspaceCoordinator struct {
	*ClusterRuntimeManager
	*ClusterWorkspaceProjection
	*RefreshCoordinator

	preferences           *PreferencesService
	operations            *OperationsCoordinator
	resources             *ResourceGateway
	appLogs               *AppLogService
	context               func() context.Context
	runtimeAvailableFn    func() bool
	emitEventFn           func(string, ...interface{})
	kubeClientInitializer func() error

	selectedKubeconfigs []string
	kubeconfigsMu       sync.RWMutex

	selectionMutationMu sync.Mutex
	workspaceSelections map[string][]string

	selectionMutationDrainMu   sync.Mutex
	selectionMutationDrainCond *sync.Cond
	selectionMutationPending   int

	kubeconfigChangeMu  sync.Mutex
	selectionGeneration atomic.Uint64
	selectionGenCtxMu   sync.Mutex
	selectionGenCancel  context.CancelFunc
	selectionDiag       selectionDiagnosticsState
	clusterIntentMu     sync.Mutex
	clusterIntentLatest map[clusterRuntimeIntentKey]uint64

	requestClusterScopeRebuildFn func(clusterID string)
	scopeRebuildQueued           sync.Map
}

func newWorkspaceCoordinator() *WorkspaceCoordinator {
	return &WorkspaceCoordinator{
		workspaceSelections: make(map[string][]string),
		clusterIntentLatest: make(map[clusterRuntimeIntentKey]uint64),
	}
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

func (w *WorkspaceCoordinator) CtxOrBackground() context.Context {
	if w == nil || w.context == nil {
		return context.Background()
	}
	if ctx := w.context(); ctx != nil {
		return ctx
	}
	return context.Background()
}

func (w *WorkspaceCoordinator) runtimeAvailable() bool {
	return w != nil && w.runtimeAvailableFn != nil && w.runtimeAvailableFn()
}

func (w *WorkspaceCoordinator) emitEvent(name string, args ...interface{}) {
	if w != nil && w.emitEventFn != nil {
		w.emitEventFn(name, args...)
	}
}
