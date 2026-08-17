package backend

import (
	"context"
	"sync"
	"sync/atomic"
)

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

type WorkspaceCoordinatorDependencies struct {
	ClusterRuntime   *ClusterRuntimeManager
	ClusterWorkspace *ClusterWorkspaceProjection
	Refresh          *RefreshCoordinator
	Preferences      *PreferencesService
	Operations       *OperationsCoordinator
	Resources        *ResourceGateway
	AppLogs          *AppLogService
	Context          func() context.Context
	RuntimeAvailable func() bool
	EmitEvent        func(string, ...interface{})
}

func newWorkspaceCoordinator(dependencies WorkspaceCoordinatorDependencies) *WorkspaceCoordinator {
	appLogs := dependencies.AppLogs
	if appLogs == nil {
		appLogs = NewAppLogService(NewLogger(1000))
	}
	clusterWorkspace := dependencies.ClusterWorkspace
	if clusterWorkspace == nil {
		clusterWorkspace = newClusterWorkspaceProjection()
	}
	clusterRuntime := dependencies.ClusterRuntime
	if clusterRuntime == nil {
		clusterRuntime = newClusterRuntimeManager(ClusterRuntimeManagerDependencies{
			Logger: appLogs.Logger(), Projection: clusterWorkspace,
		})
	}
	preferences := dependencies.Preferences
	if preferences == nil {
		preferences = NewPreferencesService(nil, nil, appLogs.Logger())
	}
	refresh := dependencies.Refresh
	if refresh == nil {
		refresh = newRefreshCoordinator(RefreshCoordinatorDependencies{
			ClusterRuntime: clusterRuntime, ClusterWorkspace: clusterWorkspace,
			Preferences: preferences, AppLogs: appLogs,
		})
	}
	contextProvider := dependencies.Context
	if contextProvider == nil {
		contextProvider = context.Background
	}
	workspace := &WorkspaceCoordinator{
		ClusterRuntimeManager:      clusterRuntime,
		ClusterWorkspaceProjection: clusterWorkspace,
		RefreshCoordinator:         refresh,
		preferences:                preferences,
		operations:                 dependencies.Operations,
		resources:                  dependencies.Resources,
		appLogs:                    appLogs,
		context:                    contextProvider,
		runtimeAvailableFn:         dependencies.RuntimeAvailable,
		emitEventFn:                dependencies.EmitEvent,
		workspaceSelections:        make(map[string][]string),
		clusterIntentLatest:        make(map[clusterRuntimeIntentKey]uint64),
	}
	workspace.kubeClientInitializer = workspace.initKubernetesClient
	return workspace
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
