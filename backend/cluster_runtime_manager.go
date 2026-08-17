package backend

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
)

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

type unavailableKubeconfigDiscoveryRepository struct {
	discovered []string
}

func (r *unavailableKubeconfigDiscoveryRepository) KubeconfigSearchPaths() ([]string, error) {
	return nil, fmt.Errorf("kubeconfig discovery repository is not configured")
}

func (r *unavailableKubeconfigDiscoveryRepository) SetDiscoveredKubeconfigSearchPaths(paths []string) {
	r.discovered = append([]string(nil), paths...)
}

func (r *unavailableKubeconfigDiscoveryRepository) DiscoveredKubeconfigSearchPaths() []string {
	return append([]string(nil), r.discovered...)
}

type ClusterRuntimeManagerDependencies struct {
	DiscoveryRepository kubeconfigDiscoveryRepository
	Logger              *Logger
	ContainerLogsPolicy *ContainerLogsSelectionPolicy
	Projection          *ClusterWorkspaceProjection
	EmitEvent           func(string, ...interface{})
	Context             func() context.Context
}

func newClusterRuntimeManager(dependencies ClusterRuntimeManagerDependencies) *ClusterRuntimeManager {
	repository := dependencies.DiscoveryRepository
	if repository == nil {
		repository = &unavailableKubeconfigDiscoveryRepository{}
	}
	logger := dependencies.Logger
	if logger == nil {
		logger = NewLogger(1000)
	}
	containerLogsPolicy := dependencies.ContainerLogsPolicy
	if containerLogsPolicy == nil {
		containerLogsPolicy = NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit)
	}
	projection := dependencies.Projection
	if projection == nil {
		projection = newClusterWorkspaceProjection()
	}
	contextProvider := dependencies.Context
	if contextProvider == nil {
		contextProvider = context.Background
	}
	return &ClusterRuntimeManager{
		discoveryRepository: repository,
		logger:              logger,
		containerLogsPolicy: containerLogsPolicy,
		projection:          projection,
		emitEvent:           dependencies.EmitEvent,
		context:             contextProvider,
		clusterClients:      make(map[string]*clusterClients),
		clusterOps:          newClusterOperationCoordinator(),
		kubeAPIMetrics:      newKubernetesAPIMetricsRegistry(),
		kubernetesQPS:       defaultKubernetesClientQPS,
		kubernetesBurst:     defaultKubernetesClientBurst,
		intents:             newClusterRuntimeIntentQueue(),
	}
}

func (m *ClusterRuntimeManager) configureDiscoveryRepository(repository kubeconfigDiscoveryRepository) {
	if m != nil && repository != nil {
		m.discoveryRepository = repository
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
