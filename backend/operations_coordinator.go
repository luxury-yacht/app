package backend

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
)

// OperationsClusterAccess is the narrow seam for cluster-scoped clients and
// transport retry accounting. Production composes it from ClusterRuntimeManager
// plus the refresh-owned retry telemetry projection.
type OperationsClusterAccess interface {
	ResolveClusterDependencies(string) (common.Dependencies, string, error)
	FetchPodWithRetry(context.Context, string, string, func(context.Context) (*corev1.Pod, error)) (*corev1.Pod, error)
}

// OperationsPermissionCheck carries the complete Kubernetes identity needed by
// live-operation permission checks.
type OperationsPermissionCheck struct {
	Group       string
	Version     string
	Kind        string
	Namespace   string
	Name        string
	Verb        string
	Subresource string
}

// OperationsPermissionChecker is the narrow authorization dependency used by
// shell, port-forward, and drain operations.
type OperationsPermissionChecker interface {
	Require(context.Context, common.Dependencies, OperationsPermissionCheck) error
	RequireAny(context.Context, common.Dependencies, ...OperationsPermissionCheck) error
}

type defaultOperationsPermissionChecker struct{}

func (defaultOperationsPermissionChecker) Require(ctx context.Context, deps common.Dependencies, check OperationsPermissionCheck) error {
	return requireResourcePermission(ctx, deps, resourcePermissionCheck(check))
}

func (defaultOperationsPermissionChecker) RequireAny(ctx context.Context, deps common.Dependencies, checks ...OperationsPermissionCheck) error {
	permissionChecks := make([]resourcePermissionCheck, 0, len(checks))
	for _, check := range checks {
		permissionChecks = append(permissionChecks, resourcePermissionCheck(check))
	}
	return requireAnyResourcePermission(ctx, deps, permissionChecks...)
}

type operationsLogger interface {
	Warn(string, ...string)
}

type operationsDrainStore interface {
	JobForCluster(string, string) (nodemaintenance.DrainJob, bool)
	CancelDrainForCluster(string, string) error
	CancelDrainForClusterLifecycle(string, string, string) bool
}

type spdyExecutorFactoryFunc func(*rest.Config, string, *url.URL) (remotecommand.Executor, error)
type websocketExecutorFactoryFunc func(*rest.Config, string, string) (remotecommand.Executor, error)

// OperationsCoordinatorDependencies contains only the capabilities needed by
// live operations. It deliberately does not accept the application composition
// root.
type OperationsCoordinatorDependencies struct {
	ClusterAccess            OperationsClusterAccess
	Permissions              OperationsPermissionChecker
	Context                  func() context.Context
	EmitEvent                func(string, ...interface{})
	Logger                   operationsLogger
	DrainStore               operationsDrainStore
	SPDYExecutorFactory      spdyExecutorFactoryFunc
	WebsocketExecutorFactory websocketExecutorFactoryFunc
}

// OperationsCoordinator owns every live shell, port-forward, and runtime
// operation plus their cluster-scoped cleanup.
type OperationsCoordinator struct {
	clusterAccess OperationsClusterAccess
	permissions   OperationsPermissionChecker
	context       func() context.Context
	emitEvent     func(string, ...interface{})
	logger        operationsLogger
	drainStore    operationsDrainStore
	spdyExecutor  spdyExecutorFactoryFunc
	websocketExec websocketExecutorFactoryFunc

	shellSessions   map[string]*shellSession
	shellSessionsMu sync.Mutex

	portForwardSessions   map[string]*portForwardSessionInternal
	portForwardSessionsMu sync.Mutex

	runtimeOperations   *runtimeOperationRegistry
	runtimeOperationsMu sync.Mutex
	operationEpochs     map[string]uint64
	operationEpochsMu   sync.Mutex
	shuttingDown        bool
	// shellStarts are node shell starts that may own a debug pod before their
	// session registers; guarded by operationEpochsMu.
	shellStarts map[*shellStart]struct{}
}

// NewOperationsCoordinator constructs the single owner for live-operation state.
func NewOperationsCoordinator(dependencies OperationsCoordinatorDependencies) *OperationsCoordinator {
	permissions := dependencies.Permissions
	if permissions == nil {
		permissions = defaultOperationsPermissionChecker{}
	}
	contextProvider := dependencies.Context
	if contextProvider == nil {
		contextProvider = context.Background
	}
	if dependencies.DrainStore == nil {
		panic("NewOperationsCoordinator: DrainStore is required")
	}
	spdyExecutor := dependencies.SPDYExecutorFactory
	if spdyExecutor == nil {
		spdyExecutor = remotecommand.NewSPDYExecutor
	}
	websocketExecutor := dependencies.WebsocketExecutorFactory
	if websocketExecutor == nil {
		websocketExecutor = remotecommand.NewWebSocketExecutor
	}
	return &OperationsCoordinator{
		clusterAccess:       dependencies.ClusterAccess,
		permissions:         permissions,
		context:             contextProvider,
		emitEvent:           dependencies.EmitEvent,
		logger:              dependencies.Logger,
		drainStore:          dependencies.DrainStore,
		spdyExecutor:        spdyExecutor,
		websocketExec:       websocketExecutor,
		shellSessions:       make(map[string]*shellSession),
		portForwardSessions: make(map[string]*portForwardSessionInternal),
		runtimeOperations:   newRuntimeOperationRegistry(),
		operationEpochs:     make(map[string]uint64),
		shellStarts:         make(map[*shellStart]struct{}),
	}
}

func (o *OperationsCoordinator) clusterOperationEpoch(clusterID string) uint64 {
	if o == nil {
		return 0
	}
	o.operationEpochsMu.Lock()
	defer o.operationEpochsMu.Unlock()
	return o.operationEpochs[clusterID]
}

func (o *OperationsCoordinator) registerRuntimeOperationAtEpoch(
	operation RuntimeOperation,
	cleanup runtimeOperationCleanup,
	epoch uint64,
) bool {
	if o == nil {
		return false
	}
	if strings.TrimSpace(operation.ID) == "" || strings.TrimSpace(operation.ClusterID) == "" {
		return false
	}
	o.operationEpochsMu.Lock()
	if o.shuttingDown || o.operationEpochs[operation.ClusterID] != epoch {
		o.operationEpochsMu.Unlock()
		return false
	}
	registry := o.ensureRuntimeOperationRegistry()
	if registry == nil {
		o.operationEpochsMu.Unlock()
		return false
	}
	registry.upsert(operation, cleanup)
	o.operationEpochsMu.Unlock()
	o.emitRuntimeOperationsList()
	return true
}

// shellStart is a start that may create cluster resources before its session
// registers. Cluster removal and shutdown cancel its context and wait on done,
// which closes once the start has released anything it created.
type shellStart struct {
	clusterID string
	cancel    context.CancelFunc
	done      chan struct{}
}

// beginShellStart admits a start for the cluster at operationEpoch, unless the
// cluster was stopped since or the app is quitting. The returned context is
// cancelled when the cluster is removed or the app quits.
func (o *OperationsCoordinator) beginShellStart(clusterID string, epoch uint64) (context.Context, *shellStart, bool) {
	o.operationEpochsMu.Lock()
	defer o.operationEpochsMu.Unlock()
	if o.shuttingDown || o.operationEpochs[clusterID] != epoch {
		return nil, nil, false
	}
	ctx, cancel := context.WithCancel(o.operationContext())
	start := &shellStart{clusterID: clusterID, cancel: cancel, done: make(chan struct{})}
	o.shellStarts[start] = struct{}{}
	return ctx, start, true
}

func (o *OperationsCoordinator) finishShellStart(start *shellStart) {
	o.operationEpochsMu.Lock()
	delete(o.shellStarts, start)
	o.operationEpochsMu.Unlock()
	start.cancel()
	close(start.done)
}

// stopShellStarts cancels the cluster's in-flight starts (every cluster's when
// clusterID is empty) and waits, bounded, until each has released what it
// created. Callers must hold no coordinator locks.
func (o *OperationsCoordinator) stopShellStarts(clusterID string) {
	o.operationEpochsMu.Lock()
	starts := make([]*shellStart, 0, len(o.shellStarts))
	for start := range o.shellStarts {
		if clusterID == "" || start.clusterID == clusterID {
			starts = append(starts, start)
		}
	}
	o.operationEpochsMu.Unlock()
	for _, start := range starts {
		start.cancel()
	}
	deadline := time.NewTimer(config.ShellStartDrainTimeout)
	defer deadline.Stop()
	for _, start := range starts {
		select {
		case <-start.done:
		case <-deadline.C:
			if o.logger != nil {
				o.logger.Warn(fmt.Sprintf("Shell starts for cluster %q did not finish cleanup within %s", clusterID, config.ShellStartDrainTimeout), logsources.ShellSession)
			}
			return
		}
	}
}

func (o *OperationsCoordinator) removeClusterRuntimeOperations(clusterID string) []runtimeOperationEntry {
	o.operationEpochsMu.Lock()
	defer o.operationEpochsMu.Unlock()
	o.operationEpochs[clusterID]++
	registry := o.ensureRuntimeOperationRegistry()
	if registry == nil {
		return nil
	}
	return registry.removeCluster(clusterID)
}

func (o *OperationsCoordinator) operationContext() context.Context {
	if o == nil || o.context == nil {
		return context.Background()
	}
	if ctx := o.context(); ctx != nil {
		return ctx
	}
	return context.Background()
}

func (o *OperationsCoordinator) publishEvent(name string, args ...interface{}) {
	if o != nil && o.emitEvent != nil {
		o.emitEvent(name, args...)
	}
}

type operationsClusterAccessFuncs struct {
	resolve  func(string) (common.Dependencies, string, error)
	fetchPod func(context.Context, string, string, func(context.Context) (*corev1.Pod, error)) (*corev1.Pod, error)
}

func (a operationsClusterAccessFuncs) ResolveClusterDependencies(clusterID string) (common.Dependencies, string, error) {
	return a.resolve(clusterID)
}

func (a operationsClusterAccessFuncs) FetchPodWithRetry(
	ctx context.Context,
	clusterID string,
	target string,
	fetch func(context.Context) (*corev1.Pod, error),
) (*corev1.Pod, error) {
	return a.fetchPod(ctx, clusterID, target, fetch)
}

func newApplicationOperationsCoordinator(
	runtimeManager *ClusterRuntimeManager,
	refreshProjection *refreshResourceProjection,
	drainStore *nodemaintenance.Store,
	contextProvider func() context.Context,
	emitEvent func(string, ...interface{}),
	logger *Logger,
) *OperationsCoordinator {
	return NewOperationsCoordinator(OperationsCoordinatorDependencies{
		ClusterAccess: operationsClusterAccessFuncs{
			resolve: runtimeManager.resolveClusterDependencies,
			fetchPod: func(ctx context.Context, clusterID, target string, fetch func(context.Context) (*corev1.Pod, error)) (*corev1.Pod, error) {
				return executeWithRetry(ctx, resourceRetryDependencies{
					recordSuccess: runtimeManager.recordClusterTransportSuccess,
					recordFailure: runtimeManager.recordClusterTransportFailure,
					telemetry:     func() resourceRetryTelemetry { return refreshProjection.currentTelemetry() },
					logger:        logger,
					clusterName:   runtimeManager.clusterNameForID,
				}, clusterID, "pod-shell", target, fetch)
			},
		},
		Permissions: defaultOperationsPermissionChecker{},
		Context:     contextProvider,
		EmitEvent:   emitEvent,
		Logger:      logger,
		DrainStore:  drainStore,
	})
}
