package backend

import (
	"context"
	"fmt"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// resourceGatewayFixture implements the cluster-runtime capabilities used by
// ResourceGateway without constructing the application composition root.
type resourceGatewayFixture struct {
	gateway          *ResourceGateway
	clustersMu       sync.Mutex
	clusters         map[string]*clusterClients
	resolvers        map[string]common.ResourceResolver
	context          context.Context
	logger           *Logger
	telemetry        *telemetry.Recorder
	emitEvent        func(string, ...interface{})
	transportSuccess func(string)
	transportFailure func(string, string, error)
	nodeMaintenance  *nodemaintenance.Store
}

func newResourceGatewayFixture() *resourceGatewayFixture {
	fixture := &resourceGatewayFixture{
		clusters:  make(map[string]*clusterClients),
		resolvers: make(map[string]common.ResourceResolver),
		context:   context.Background(),
		logger:    NewLogger(1000),
		telemetry: telemetry.NewRecorder(),
	}
	refreshProjection := newRefreshResourceProjection()
	refreshProjection.publishTelemetry(fixture.telemetry)
	fixture.nodeMaintenance = nodemaintenance.NewStore(5)
	operations := NewOperationsCoordinator(OperationsCoordinatorDependencies{
		ClusterAccess: fixture,
		Permissions:   defaultOperationsPermissionChecker{},
		Context:       func() context.Context { return fixture.context },
		EmitEvent: func(name string, args ...interface{}) {
			if fixture.emitEvent != nil {
				fixture.emitEvent(name, args...)
			}
		},
		Logger:     fixture.logger,
		DrainStore: fixture.nodeMaintenance,
	})
	fixture.gateway = newResourceGateway(resourceGatewayDependencies{
		resolveClusterDependencies:       fixture.ResolveClusterDependencies,
		resourceDependenciesForClusterID: fixture.resourceDependenciesForClusterID,
		context:                          func() context.Context { return fixture.context },
		emitEvent: func(name string, args ...interface{}) {
			if fixture.emitEvent != nil {
				fixture.emitEvent(name, args...)
			}
		},
		logger:      fixture.logger,
		clusterName: fixture.clusterName,
		recordTransportSuccess: func(clusterID string) {
			if fixture.transportSuccess != nil {
				fixture.transportSuccess(clusterID)
			}
		},
		recordTransportFailure: func(clusterID, reason string, err error) {
			if fixture.transportFailure != nil {
				fixture.transportFailure(clusterID, reason, err)
			}
		},
		resourceResolverForCluster: func(clusterID string) common.ResourceResolver {
			return fixture.resourceResolver(clusterID)
		},
		refreshProjection:            refreshProjection,
		permissionFetchPolicy:        NewPermissionFetchPolicy(defaultPermissionSSRRFetchConcurrency),
		containerLogsSelectionPolicy: NewContainerLogsSelectionPolicy(defaultObjPanelLogsTargetPerScopeLimit),
		nodeMaintenanceStore:         fixture.nodeMaintenance,
		operations:                   operations,
	})
	return fixture
}

func (f *resourceGatewayFixture) setTelemetryRecorder(recorder *telemetry.Recorder) {
	f.telemetry = recorder
	f.gateway.refreshProjection.publishTelemetry(recorder)
}

func (f *resourceGatewayFixture) setCluster(clusterID string, clients *clusterClients) {
	f.clustersMu.Lock()
	defer f.clustersMu.Unlock()
	if clients == nil {
		delete(f.clusters, clusterID)
		delete(f.resolvers, clusterID)
		return
	}
	f.clusters[clusterID] = clients
	delete(f.resolvers, clusterID)
}

func (f *resourceGatewayFixture) ResolveClusterDependencies(clusterID string) (common.Dependencies, string, error) {
	if clusterID == "" {
		return common.Dependencies{}, "", fmt.Errorf("cluster id is required")
	}
	f.clustersMu.Lock()
	clients := f.clusters[clusterID]
	f.clustersMu.Unlock()
	if clients == nil {
		return common.Dependencies{}, "", fmt.Errorf("cluster %s not active", clusterID)
	}
	if clients.authManager != nil && !clients.authManager.IsValid() {
		name := clusterID
		if clients.meta.Name != "" {
			name = clients.meta.Name
		}
		return common.Dependencies{}, "", fmt.Errorf("auth failed for %s: check your kubeconfig credentials", name)
	}
	deps, ok := f.resourceDependenciesForClusterID(clusterID)
	if !ok {
		return common.Dependencies{}, "", fmt.Errorf("cluster %s not active", clusterID)
	}
	deps.Logger = applog.OperationScoped(deps.Logger, applog.NextOperationID("resource-test"))
	return deps, clusterID, nil
}

func (f *resourceGatewayFixture) resourceDependenciesForClusterID(clusterID string) (common.Dependencies, bool) {
	f.clustersMu.Lock()
	clients := f.clusters[clusterID]
	f.clustersMu.Unlock()
	if clients == nil {
		return common.Dependencies{}, false
	}
	var metrics metricsclient.Interface
	if clients.metricsClient != nil {
		metrics = clients.metricsClient
	}
	deps := common.Dependencies{
		Logger:                 applog.ClusterScoped(f.logger, clusterID, clients.meta.Name),
		KubernetesClient:       clients.client,
		GatewayClient:          clients.gatewayClient,
		GatewayAPIPresence:     clients.gatewayAPIPresence,
		GatewayVersionResolver: clients.gatewayVersionResolver,
		MetricsClient:          metrics,
		DynamicClient:          clients.dynamicClient,
		APIExtensionsClient:    clients.apiextensionsClient,
		RestConfig:             clients.restConfig,
		SelectedKubeconfig:     clients.kubeconfigPath,
		SelectedContext:        clients.kubeconfigContext,
		ClusterID:              clusterID,
		ClusterName:            clients.meta.Name,
		ResourceResolver:       f.resourceResolver(clusterID),
	}
	deps.EnsureClient = func(resourceKind string) error {
		if deps.KubernetesClient == nil {
			applog.Error(deps.Logger, fmt.Sprintf("Kubernetes client not initialized for %s fetch", resourceKind), logsources.ResourceLoader)
			return fmt.Errorf("kubernetes client not initialized")
		}
		return nil
	}
	deps.EnsureAPIExtensions = func(resourceKind string) error {
		if deps.APIExtensionsClient == nil {
			return fmt.Errorf("apiextensions client not initialized")
		}
		return nil
	}
	deps.SetMetricsClient = func(client metricsclient.Interface) {
		if typed, ok := client.(*metricsclient.Clientset); ok {
			clients.metricsClient = typed
		}
	}
	return deps, true
}

func (f *resourceGatewayFixture) resourceResolver(clusterID string) common.ResourceResolver {
	f.clustersMu.Lock()
	defer f.clustersMu.Unlock()
	if resolver := f.resolvers[clusterID]; resolver != nil {
		return resolver
	}
	clients := f.clusters[clusterID]
	if clients == nil {
		return nil
	}
	deps, ok := f.resourceDependenciesForClusterIDUnlocked(clusterID, clients)
	if !ok {
		return nil
	}
	resolver := objectcatalog.NewResourceResolver(deps, deps.Logger)
	f.resolvers[clusterID] = resolver
	return resolver
}

func (f *resourceGatewayFixture) resourceDependenciesForClusterIDUnlocked(clusterID string, clients *clusterClients) (common.Dependencies, bool) {
	if clients == nil {
		return common.Dependencies{}, false
	}
	return common.Dependencies{
		Logger:              applog.ClusterScoped(f.logger, clusterID, clients.meta.Name),
		KubernetesClient:    clients.client,
		DynamicClient:       clients.dynamicClient,
		APIExtensionsClient: clients.apiextensionsClient,
		ClusterID:           clusterID,
		ClusterName:         clients.meta.Name,
	}, true
}

func (f *resourceGatewayFixture) clusterName(clusterID string) string {
	f.clustersMu.Lock()
	defer f.clustersMu.Unlock()
	if clients := f.clusters[clusterID]; clients != nil && clients.meta.Name != "" {
		return clients.meta.Name
	}
	return clusterID
}

func (f *resourceGatewayFixture) FetchPodWithRetry(
	ctx context.Context,
	clusterID string,
	target string,
	fetch func(context.Context) (*corev1.Pod, error),
) (*corev1.Pod, error) {
	return executeWithRetry(ctx, f.gateway.resourceRetryDependencies(), clusterID, "pod-shell", target, fetch)
}
