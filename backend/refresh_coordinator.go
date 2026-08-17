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
