package backend

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resources/common"
)

type workspaceClusterRuntime interface {
	affectedKubeconfigClusters(map[string]struct{}) []string
	availableKubeconfigCount() int
	buildClusterClientsWithContext(context.Context, kubeconfigSelection, ClusterMeta) (*clusterClients, error)
	buildClusterClientsWithManager(context.Context, kubeconfigSelection, ClusterMeta, *authstate.Manager) (*clusterClients, error)
	buildNamespacesReadiness(*aggregateSnapshotService, string)
	clearClusterClientPool() []removedClusterClient
	clusterAuthDisplayName(string) string
	clusterClientCreateTasks(map[string]kubeconfigSelection) []clusterClientCreateTask
	clusterClientsForID(string) *clusterClients
	clusterClientsForSelection(kubeconfigSelection) *clusterClients
	clusterLifecycleState(string) ClusterLifecycleState
	clusterLifecycleStates() map[string]ClusterLifecycleState
	clusterMetaForSelection(kubeconfigSelection) ClusterMeta
	clusterNameForID(string) string
	clusterWorkspaceAuthStates() map[string]ClusterWorkspaceClusterState
	createClusterClients(context.Context, []clusterClientCreateTask, clusterClientBuilder) error
	desiredClusterClientSelections([]kubeconfigSelection) map[string]kubeconfigSelection
	discoverKubeconfigs() error
	discoverableKubeconfigSelections() map[kubeconfigSelectionKey]struct{}
	ensureClusterClientsForSelections(context.Context, []kubeconfigSelection) error
	ensureKubernetesAPIMetricsRegistry() *kubernetesAPIMetricsRegistry
	getTransportState(string) *transportFailureState
	normalizeKubeconfigSelection(string) (kubeconfigSelection, error)
	refreshKubeconfigDiscoveryAndWatch() error
	removeClusterClients([]string) []removedClusterClient
	removeClusterLifecycleState(string)
	removeUndesiredClusterClients(map[string]kubeconfigSelection) []removedClusterClient
	replaceClusterClient(string, *clusterClients)
	replayClusterLifecycle(string)
	resourceDependenciesForSelection(kubeconfigSelection, *clusterClients, string) common.Dependencies
	runClusterOperation(context.Context, string, func(context.Context) error) error
	selectionsForClusterIDs([]string) []kubeconfigSelection
	setClusterLifecycleState(string, ClusterLifecycleState)
	snapshotClusterIDs() []string
	startHeartbeatLoop(context.Context)
	validateKubeconfigSelection(kubeconfigSelection) error
}

type workspaceClusterProjection interface {
	clusterWorkspaceRuntimeState() (map[string]ClusterHealthState, map[string]uint64)
	incrementClusterScopeRevision(string)
	markClusterWorkspaceChanged()
	removeClusterWorkspaceRuntimeState(string)
	revision() uint64
	setClusterHealth(string, ClusterHealthState)
}

type workspaceRefresh interface {
	SetVisibleCluster(string)
	SetWindowVisibleCluster(string, string)
	currentTelemetryRecorder() *telemetry.Recorder
	rebuildClusterSubsystem(string)
	releaseWorkspaceWindowForeground(string)
	setupRefreshSubsystemForSelections([]kubeconfigSelection) error
	startObjectCatalogForTarget(catalogTarget) error
	stopObjectCatalog()
	teardownClusterSubsystem(string)
	teardownRefreshSubsystem()
	updateRefreshSubsystemSelections([]kubeconfigSelection) error
	visibleClusterForWindow(string) string
}

type workspacePreferences interface {
	EnsureLoadedForStartup() (PreferencesSnapshot, error)
	SaveKubeconfigSearchPaths([]string) error
	SaveSelectedKubeconfigs([]string) error
	SelectedKubeconfigs() []string
	SetSelectedKubeconfigsSnapshot([]string)
	cacheDirPath() (string, error)
	clusterAllowedNamespaces(string) ([]string, error)
	saveClusterAllowedNamespaces(string, []string) ([]string, error)
}

type clusterStopper interface {
	StopCluster(string)
}

// WorkspaceCoordinator is the sole state owner for peer-window selections,
// serialized selection mutations, supersession generations, selection
// diagnostics, and namespace-scope rebuild coalescing.
type WorkspaceCoordinator struct {
	clusterRuntime   workspaceClusterRuntime
	clusterWorkspace workspaceClusterProjection
	refresh          workspaceRefresh

	preferences           workspacePreferences
	operations            clusterStopper
	logger                *Logger
	context               func() context.Context
	runtimeAvailableFn    func() bool
	emitEventFn           func(string, ...interface{})
	kubeClientInitializer func(context.Context) error

	selectedKubeconfigs []string
	kubeconfigsMu       sync.RWMutex

	selectionMutationMu   sync.Mutex
	workspaceSelectionsMu sync.RWMutex
	workspaceSelections   map[string][]string

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
	ClusterRuntime   workspaceClusterRuntime
	ClusterWorkspace workspaceClusterProjection
	Refresh          workspaceRefresh
	Preferences      workspacePreferences
	Operations       clusterStopper
	Logger           *Logger
	Context          func() context.Context
	RuntimeAvailable func() bool
	EmitEvent        func(string, ...interface{})
}

func newWorkspaceCoordinator(dependencies WorkspaceCoordinatorDependencies) *WorkspaceCoordinator {
	requireWorkspaceCoordinatorDependencies(dependencies)
	workspace := &WorkspaceCoordinator{
		clusterRuntime:      dependencies.ClusterRuntime,
		clusterWorkspace:    dependencies.ClusterWorkspace,
		refresh:             dependencies.Refresh,
		preferences:         dependencies.Preferences,
		operations:          dependencies.Operations,
		logger:              dependencies.Logger,
		context:             dependencies.Context,
		runtimeAvailableFn:  dependencies.RuntimeAvailable,
		emitEventFn:         dependencies.EmitEvent,
		workspaceSelections: make(map[string][]string),
		clusterIntentLatest: make(map[clusterRuntimeIntentKey]uint64),
	}
	return workspace
}

func requireWorkspaceCoordinatorDependencies(dependencies WorkspaceCoordinatorDependencies) {
	switch {
	case dependencies.ClusterRuntime == nil:
		panic("newWorkspaceCoordinator: ClusterRuntime is required")
	case dependencies.ClusterWorkspace == nil:
		panic("newWorkspaceCoordinator: ClusterWorkspace is required")
	case dependencies.Refresh == nil:
		panic("newWorkspaceCoordinator: Refresh is required")
	case dependencies.Preferences == nil:
		panic("newWorkspaceCoordinator: Preferences is required")
	case dependencies.Operations == nil:
		panic("newWorkspaceCoordinator: Operations is required")
	case dependencies.Logger == nil:
		panic("newWorkspaceCoordinator: Logger is required")
	case dependencies.Context == nil:
		panic("newWorkspaceCoordinator: Context is required")
	case dependencies.RuntimeAvailable == nil:
		panic("newWorkspaceCoordinator: RuntimeAvailable is required")
	case dependencies.EmitEvent == nil:
		panic("newWorkspaceCoordinator: EmitEvent is required")
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
