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

func newWorkspaceCoordinator() *WorkspaceCoordinator {
	return &WorkspaceCoordinator{
		workspaceSelections: make(map[string][]string),
		clusterIntentLatest: make(map[clusterRuntimeIntentKey]uint64),
	}
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
