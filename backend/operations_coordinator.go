package backend

import (
	"context"
	"net/url"
	"strings"
	"sync"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
)

// OperationsClusterAccess is the temporary App-backed seam for resolving
// cluster-scoped clients and preserving transport retry accounting. Phase 5A
// replaces its implementation with ClusterRuntimeManager.
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
// live operations. It deliberately does not accept *App.
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
	drainStore := dependencies.DrainStore
	if drainStore == nil {
		drainStore = nodemaintenance.GlobalStore()
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
		drainStore:          drainStore,
		spdyExecutor:        spdyExecutor,
		websocketExec:       websocketExecutor,
		shellSessions:       make(map[string]*shellSession),
		portForwardSessions: make(map[string]*portForwardSessionInternal),
		runtimeOperations:   newRuntimeOperationRegistry(),
		operationEpochs:     make(map[string]uint64),
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

// OperationsCoordinator returns the live-operation owner composed for this App.
func (a *App) OperationsCoordinator() *OperationsCoordinator {
	if a == nil {
		return nil
	}
	return a.operations
}

func (a *App) initializeOperationsCoordinator() {
	if a == nil {
		return
	}
	a.operations = NewOperationsCoordinator(OperationsCoordinatorDependencies{
		ClusterAccess: operationsClusterAccessFuncs{
			resolve: a.resolveClusterDependencies,
			fetchPod: func(ctx context.Context, clusterID, target string, fetch func(context.Context) (*corev1.Pod, error)) (*corev1.Pod, error) {
				return executeWithRetry(ctx, a, clusterID, "pod-shell", target, fetch)
			},
		},
		Permissions: defaultOperationsPermissionChecker{},
		Context:     a.CtxOrBackground,
		EmitEvent:   a.emitEvent,
		Logger:      a.logger,
		DrainStore:  nodemaintenance.GlobalStore(),
	})
}
