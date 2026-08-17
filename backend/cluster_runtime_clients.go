package backend

import (
	"context"
	"fmt"
	"net/http"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	appconfig "github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	informerpkg "github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
)

// setClusterClientLocked commits one client-map entry and its workspace
// revision together. The caller must hold clusterClientsMu.
func (a *ClusterRuntimeManager) setClusterClientLocked(clusterID string, clients *clusterClients) {
	if a.clusterClients == nil {
		a.clusterClients = make(map[string]*clusterClients)
	}
	a.clusterClients[clusterID] = clients
	a.projection.markClusterWorkspaceChanged()
}

// removeClusterClientLocked removes one client-map entry. The caller must hold
// clusterClientsMu.
func (a *ClusterRuntimeManager) removeClusterClientLocked(clusterID string) (*clusterClients, bool) {
	clients, ok := a.clusterClients[clusterID]
	if !ok {
		return nil, false
	}
	delete(a.clusterClients, clusterID)
	a.projection.markClusterWorkspaceChanged()
	return clients, true
}

// clearClusterClientsLocked removes every client-map entry. The caller must
// hold clusterClientsMu.
func (a *ClusterRuntimeManager) clearClusterClientsLocked() {
	if len(a.clusterClients) == 0 {
		return
	}
	a.clusterClients = make(map[string]*clusterClients)
	a.projection.markClusterWorkspaceChanged()
}

func (m *ClusterRuntimeManager) clusterClientsForID(clusterID string) *clusterClients {
	if m == nil || clusterID == "" {
		return nil
	}
	m.clusterClientsMu.Lock()
	defer m.clusterClientsMu.Unlock()
	return m.clusterClients[clusterID]
}

func (m *ClusterRuntimeManager) replaceClusterClient(clusterID string, clients *clusterClients) {
	if m == nil || clusterID == "" || clients == nil {
		return
	}
	m.clusterClientsMu.Lock()
	m.setClusterClientLocked(clusterID, clients)
	m.clusterClientsMu.Unlock()
}

// clusterClientsForSelection finds stored clients by matching the kubeconfig path
// and context, regardless of what ID was derived. This handles cases where
// clusterMetaForSelection re-derives a different ID than what was used at build time.
func (m *ClusterRuntimeManager) clusterClientsForSelection(selection kubeconfigSelection) *clusterClients {
	if m == nil {
		return nil
	}
	m.clusterClientsMu.Lock()
	defer m.clusterClientsMu.Unlock()
	return m.clusterClientsForSelectionLocked(selection)
}

func (m *ClusterRuntimeManager) clusterClientsForSelectionLocked(selection kubeconfigSelection) *clusterClients {
	for _, c := range m.clusterClients {
		if c != nil && c.kubeconfigPath == selection.Path && c.kubeconfigContext == selection.Context {
			return c
		}
	}
	return nil
}

func (m *ClusterRuntimeManager) ensureClusterClientsForSelections(ctx context.Context, selections []kubeconfigSelection) error {
	if m == nil {
		return fmt.Errorf("cluster runtime manager is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	desired := m.desiredClusterClientSelections(selections)
	tasks := m.clusterClientCreateTasks(desired)
	return m.createClusterClients(ctx, tasks, m.buildClusterClientsWithContext)
}

func (m *ClusterRuntimeManager) snapshotClusterIDs() []string {
	if m == nil {
		return nil
	}
	m.clusterClientsMu.Lock()
	defer m.clusterClientsMu.Unlock()
	ids := make([]string, 0, len(m.clusterClients))
	for clusterID := range m.clusterClients {
		ids = append(ids, clusterID)
	}
	return ids
}

func (m *ClusterRuntimeManager) selectionsForClusterIDs(clusterIDs []string) []kubeconfigSelection {
	if m == nil {
		return nil
	}
	m.clusterClientsMu.Lock()
	defer m.clusterClientsMu.Unlock()
	selections := make([]kubeconfigSelection, 0, len(clusterIDs))
	for _, clusterID := range clusterIDs {
		clients := m.clusterClients[clusterID]
		if clients == nil {
			continue
		}
		selections = append(selections, kubeconfigSelection{Path: clients.kubeconfigPath, Context: clients.kubeconfigContext})
	}
	return selections
}

func (m *ClusterRuntimeManager) removeClusterLifecycleState(clusterID string) {
	if m != nil && m.clusterLifecycle != nil {
		m.clusterLifecycle.Remove(clusterID)
	}
}

func (m *ClusterRuntimeManager) clusterLifecycleStates() map[string]ClusterLifecycleState {
	if m == nil || m.clusterLifecycle == nil {
		return nil
	}
	return m.clusterLifecycle.GetAllStates()
}

func (m *ClusterRuntimeManager) replayClusterLifecycle(clusterID string) {
	if m != nil && m.clusterLifecycle != nil {
		m.clusterLifecycle.Replay(clusterID)
	}
}

func (m *ClusterRuntimeManager) clusterLifecycleState(clusterID string) ClusterLifecycleState {
	if m == nil || m.clusterLifecycle == nil {
		return ""
	}
	return m.clusterLifecycle.GetState(clusterID)
}

func (m *ClusterRuntimeManager) setClusterLifecycleState(clusterID string, state ClusterLifecycleState) {
	if m != nil && m.clusterLifecycle != nil {
		m.clusterLifecycle.SetState(clusterID, state)
	}
}

func (m *ClusterRuntimeManager) buildNamespacesReadiness(service *aggregateSnapshotService, clusterID string) {
	if m == nil {
		return
	}
	runNamespacesReadinessSelfBuild(m.clusterLifecycle, service, clusterID)
}

func (a *ClusterRuntimeManager) desiredClusterClientSelections(selections []kubeconfigSelection) map[string]kubeconfigSelection {
	desired := make(map[string]kubeconfigSelection, len(selections))
	for _, selection := range selections {
		if existing := a.clusterClientsForSelection(selection); existing != nil {
			desired[existing.meta.ID] = selection
			continue
		}
		meta := a.clusterMetaForSelection(selection)
		if meta.ID != "" {
			desired[meta.ID] = selection
		}
	}
	return desired
}

func (a *ClusterRuntimeManager) clusterClientCreateTasks(desired map[string]kubeconfigSelection) []clusterClientCreateTask {
	a.clusterClientsMu.Lock()
	missing := make([]kubeconfigSelection, 0, len(desired))
	for id, selection := range desired {
		if _, exists := a.clusterClients[id]; !exists {
			missing = append(missing, selection)
		}
	}
	a.clusterClientsMu.Unlock()

	tasks := make([]clusterClientCreateTask, 0, len(missing))
	for _, selection := range missing {
		meta := a.clusterMetaForSelection(selection)
		if meta.ID != "" {
			tasks = append(tasks, clusterClientCreateTask{selection: selection, meta: meta})
		}
	}
	return tasks
}

func (a *ClusterRuntimeManager) createClusterClients(ctx context.Context, tasks []clusterClientCreateTask, build clusterClientBuilder) error {
	a.markClusterClientTasksConnecting(tasks)
	limit := clusterClientBuildConcurrencyLimit(len(tasks))
	return parallel.ForEach(ctx, tasks, limit, func(taskCtx context.Context, task clusterClientCreateTask) error {
		return a.runClusterOperation(taskCtx, task.meta.ID, func(opCtx context.Context) error {
			return a.buildAndInstallClusterClient(opCtx, task, build)
		})
	})
}

func (a *ClusterRuntimeManager) markClusterClientTasksConnecting(tasks []clusterClientCreateTask) {
	if a.clusterLifecycle == nil {
		return
	}
	for _, task := range tasks {
		a.clusterLifecycle.SetState(task.meta.ID, ClusterStateConnecting)
	}
}

func (a *ClusterRuntimeManager) buildAndInstallClusterClient(ctx context.Context, task clusterClientCreateTask, build clusterClientBuilder) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if a.clusterClientAlreadyInstalled(task) {
		return nil
	}
	clients, err := build(ctx, task.selection, task.meta)
	if err != nil {
		return err
	}
	if clients == nil {
		return fmt.Errorf("cluster client builder returned nil clients for %s", task.meta.ID)
	}
	if err := ctx.Err(); err != nil {
		shutdownClusterClientAuthManager(clients)
		return err
	}
	if !a.installClusterClient(task, clients) {
		shutdownClusterClientAuthManager(clients)
		return nil
	}
	if a.clusterLifecycle != nil {
		a.clusterLifecycle.SetState(task.meta.ID, ClusterStateConnected)
	}
	return nil
}

func (a *ClusterRuntimeManager) clusterClientAlreadyInstalled(task clusterClientCreateTask) bool {
	return a.clusterClientsForID(task.meta.ID) != nil || a.clusterClientsForSelection(task.selection) != nil
}

func (a *ClusterRuntimeManager) installClusterClient(task clusterClientCreateTask, clients *clusterClients) bool {
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	if a.clusterClients[task.meta.ID] != nil || a.clusterClientsForSelectionLocked(task.selection) != nil {
		return false
	}
	a.setClusterClientLocked(task.meta.ID, clients)
	return true
}

func (a *ClusterRuntimeManager) removeUndesiredClusterClients(desired map[string]kubeconfigSelection) []removedClusterClient {
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	var removed []removedClusterClient
	for id, clients := range a.clusterClients {
		if _, keep := desired[id]; keep {
			continue
		}
		removed = append(removed, removedClusterClient{clusterID: id, authManager: clusterClientAuthManager(clients)})
		a.removeClusterClientLocked(id)
	}
	return removed
}

func (a *ClusterRuntimeManager) removeClusterClients(clusterIDs []string) []removedClusterClient {
	if a == nil {
		return nil
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	removed := make([]removedClusterClient, 0, len(clusterIDs))
	for _, clusterID := range clusterIDs {
		clients, ok := a.removeClusterClientLocked(clusterID)
		if !ok {
			continue
		}
		removed = append(removed, removedClusterClient{
			clusterID:   clusterID,
			authManager: clusterClientAuthManager(clients),
		})
	}
	return removed
}

func (a *ClusterRuntimeManager) clearClusterClientPool() []removedClusterClient {
	if a == nil {
		return nil
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	removed := make([]removedClusterClient, 0, len(a.clusterClients))
	for clusterID, clients := range a.clusterClients {
		removed = append(removed, removedClusterClient{
			clusterID:   clusterID,
			authManager: clusterClientAuthManager(clients),
		})
	}
	a.clearClusterClientsLocked()
	return removed
}

func (m *ClusterRuntimeManager) applyKubernetesClientRateLimits(qps, burst int) {
	if m == nil {
		return
	}
	qps = clampKubernetesClientQPS(qps)
	burst = clampKubernetesClientBurst(burst)
	m.rateLimitMu.Lock()
	m.kubernetesQPS = qps
	m.kubernetesBurst = burst
	m.rateLimitMu.Unlock()

	m.clusterClientsMu.Lock()
	clients := make([]*clusterClients, 0, len(m.clusterClients))
	for _, item := range m.clusterClients {
		if item != nil {
			clients = append(clients, item)
		}
	}
	m.clusterClientsMu.Unlock()

	registry := m.ensureKubernetesAPIMetricsRegistry()
	for _, item := range clients {
		if item.rateLimiter != nil {
			item.rateLimiter.Set(qps, burst)
		}
		registry.getOrCreate(item.meta, qps, burst)
		if item.restConfig != nil {
			item.restConfig.QPS = float32(qps)
			item.restConfig.Burst = burst
		}
	}
}

func (m *ClusterRuntimeManager) kubernetesClientRateLimits() (int, int) {
	if m == nil {
		return defaultKubernetesClientQPS, defaultKubernetesClientBurst
	}
	m.rateLimitMu.RLock()
	defer m.rateLimitMu.RUnlock()
	return m.kubernetesQPS, m.kubernetesBurst
}

// buildClusterClientsWithContext initializes client-go dependencies for a specific kubeconfig selection.
// The preflight check is context-bound so superseding selection generations can preempt stale work.
func (a *ClusterRuntimeManager) buildClusterClientsWithContext(
	ctx context.Context,
	selection kubeconfigSelection,
	meta ClusterMeta,
) (*clusterClients, error) {
	return a.buildClusterClientsWithManager(ctx, selection, meta, nil)
}

// buildClusterClientsWithManager initializes client-go dependencies for a specific
// kubeconfig selection. When existingMgr is non-nil (subsystem rebuilds), the new
// clients' transports are wired to it so auth failures keep reaching the manager
// the app tracks; otherwise a fresh per-cluster manager is created. A reused
// manager is never shut down here — the previous clients still reference it.
func (a *ClusterRuntimeManager) buildClusterClientsWithManager(
	ctx context.Context,
	selection kubeconfigSelection,
	meta ClusterMeta,
	existingMgr *authstate.Manager,
) (*clusterClients, error) {
	// Per-cluster auth manager: auth failures in one cluster don't affect others.
	clusterAuthMgr := existingMgr
	ownsManager := clusterAuthMgr == nil
	if ownsManager {
		clusterAuthMgr = a.createClusterAuthManager(meta)
	}

	config, err := a.buildRestConfigForSelection(selection, meta, clusterAuthMgr)
	if err != nil {
		shutdownClusterAuthManagerIfOwned(clusterAuthMgr, ownsManager)
		return nil, err
	}

	// Built-in kinds negotiate Protobuf (with a JSON fallback the SERVER picks per
	// endpoint), cutting the initial-sync transfer and decode cost. The dynamic and
	// gateway clients below keep the base config: custom resources are JSON-only.
	typedConfig := protobufRestConfig(config)
	dependencies, err := a.buildClusterClientDependencies(ctx, config, typedConfig, meta)
	if err != nil {
		shutdownClusterAuthManagerIfOwned(clusterAuthMgr, ownsManager)
		return nil, err
	}

	configureClusterRecoveryTest(clusterAuthMgr, selection)
	authFailedOnInit := a.clusterAuthFailedOnPreflight(ctx, dependencies.client, config, clusterAuthMgr, meta)

	return &clusterClients{
		meta:                   meta,
		kubeconfigPath:         selection.Path,
		kubeconfigContext:      selection.Context,
		client:                 dependencies.client,
		gatewayClient:          dependencies.gatewayClient,
		gatewayInformerFactory: dependencies.gatewayInformerFactory,
		gatewayAPIPresence:     dependencies.gatewayAPIPresence,
		gatewayVersionResolver: dependencies.gatewayAPIPresence,
		apiextensionsClient:    dependencies.apiextensionsClient,
		dynamicClient:          dependencies.dynamicClient,
		metricsClient:          dependencies.metricsClient,
		restConfig:             config,
		rateLimiter:            config.RateLimiter.(*mutableKubernetesRateLimiter),
		authManager:            clusterAuthMgr,
		authFailedOnInit:       authFailedOnInit,
	}, nil
}

func (a *ClusterRuntimeManager) buildClusterClientDependencies(
	ctx context.Context,
	config *rest.Config,
	typedConfig *rest.Config,
	meta ClusterMeta,
) (builtClusterClientDependencies, error) {
	clientset, err := kubernetes.NewForConfig(typedConfig)
	if err != nil {
		return builtClusterClientDependencies{}, fmt.Errorf("failed to create clientset: %w", err)
	}

	apiextensionsClient, err := apiextensionsclientset.NewForConfig(typedConfig)
	if err != nil {
		return builtClusterClientDependencies{}, fmt.Errorf("failed to create apiextensions clientset: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return builtClusterClientDependencies{}, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	metrics := a.buildMetricsClient(typedConfig, meta)
	gatewayPresence, gatewayClient, gatewayInformerFactory, err := a.buildGatewayClients(ctx, config, clientset, meta)
	if err != nil {
		return builtClusterClientDependencies{}, err
	}

	return builtClusterClientDependencies{
		client:                 clientset,
		gatewayClient:          gatewayClient,
		gatewayInformerFactory: gatewayInformerFactory,
		gatewayAPIPresence:     gatewayPresence,
		apiextensionsClient:    apiextensionsClient,
		dynamicClient:          dynamicClient,
		metricsClient:          metrics,
	}, nil
}

func (a *ClusterRuntimeManager) buildMetricsClient(config *rest.Config, meta ClusterMeta) *metricsclient.Clientset {
	client, err := metricsclient.NewForConfig(config)
	if err != nil {
		a.logger.Info(fmt.Sprintf("Metrics client not available for cluster %s: %v", meta.ID, err), logsources.KubernetesClient, meta.ID, meta.Name)
		return nil
	}
	return client
}

func (a *ClusterRuntimeManager) buildGatewayClients(
	ctx context.Context,
	config *rest.Config,
	clientset kubernetes.Interface,
	meta ClusterMeta,
) (*gatewayapi.Presence, gatewayversioned.Interface, gatewayinformers.SharedInformerFactory, error) {
	presence, discoverErr := gatewayapi.DiscoverViaDiscovery(ctx, clientset.Discovery())
	if discoverErr != nil {
		a.logger.Warn(fmt.Sprintf("Gateway API discovery failed for cluster %s: %v", meta.Name, discoverErr), logsources.KubernetesClient, meta.ID, meta.Name)
	}
	if !presence.AnyPresent() {
		return presence, nil, nil, nil
	}

	client, err := gatewayversioned.NewForConfig(config)
	if err != nil {
		return gatewayapi.EmptyPresence(), nil, nil, fmt.Errorf("failed to create gateway api clientset: %w", err)
	}
	factory := gatewayinformers.NewSharedInformerFactoryWithOptions(
		client,
		appconfig.RefreshResyncInterval,
		gatewayinformers.WithTransform(informerpkg.StripManagedFields),
	)
	return presence, client, factory, nil
}

func (a *ClusterRuntimeManager) clusterAuthFailedOnPreflight(
	ctx context.Context,
	client kubernetes.Interface,
	config *rest.Config,
	manager *authstate.Manager,
	meta ClusterMeta,
) bool {
	err := a.preflightClusterClientWithContext(ctx, client)
	if err == nil {
		a.logger.Info(fmt.Sprintf("Pre-flight check passed for cluster %s", meta.Name), logsources.Auth, meta.ID, meta.Name)
		return false
	}

	a.logger.Warn(fmt.Sprintf("Pre-flight check failed for cluster %s: %v", meta.Name, err), logsources.Auth, meta.ID, meta.Name)
	diagnostic := credentialerrors.Classify(err, credentialerrors.Context{ExecCommand: execDisplayCommand(config)})
	if !diagnostic.IsAuth() {
		return false
	}

	a.logger.Warn(fmt.Sprintf("Detected credential error for cluster %s, reporting auth failure", meta.Name), logsources.Auth, meta.ID, meta.Name)
	manager.ReportFailureDiagnostic(authstate.NewFailureDiagnostic(err, diagnostic))
	return true
}

func (a *ClusterRuntimeManager) preflightClusterClientWithContext(ctx context.Context, client kubernetes.Interface) error {
	if client == nil || client.Discovery() == nil {
		return fmt.Errorf("discovery client unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	preflightCtx, cancel := context.WithTimeout(ctx, appconfig.KubernetesClientPreflightTimeout)
	defer cancel()

	restClient := client.Discovery().RESTClient()
	if restClient == nil {
		// Fallback for fake/test discovery implementations.
		_, err := client.Discovery().ServerVersion()
		return err
	}

	_, err := restClient.Get().AbsPath("/version").DoRaw(preflightCtx)
	return err
}

// createClusterAuthManager creates a new auth state manager for a specific cluster.
func (m *ClusterRuntimeManager) createClusterAuthManager(meta ClusterMeta) *authstate.Manager {
	return authstate.New(authstate.Config{
		MaxAttempts:               authstate.DefaultMaxAttempts,
		BackoffSchedule:           authstate.DefaultBackoffSchedule,
		ClassifyError:             classifyRecoveryError,
		ConnectivityRetryInterval: appconfig.ClusterAuthConnectivityRetryInterval,
		SteadyRetryInterval:       appconfig.ClusterAuthSteadyRetryInterval,
		OnStateChange: func(state authstate.State, diag authstate.FailureDiagnostic) {
			m.handleClusterAuthStateChange(meta.ID, state, diag)
		},
		OnRecoveryProgress: func(progress authstate.RecoveryProgress) {
			m.handleClusterAuthRecoveryProgress(meta.ID, progress)
		},
		OnSnapshotChange: m.projection.markClusterWorkspaceChanged,
		// RecoveryTest is set later once we have the clientset
	})
}

// the transport for auth state tracking.
func (a *ClusterRuntimeManager) buildRestConfigForSelection(selection kubeconfigSelection, meta ClusterMeta, clusterAuthMgr *authstate.Manager) (*rest.Config, error) {
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	loadingRules.ExplicitPath = selection.Path
	overrides := &clientcmd.ConfigOverrides{}
	if selection.Context != "" {
		overrides.CurrentContext = selection.Context
	}

	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)
	config, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to build config from %s: %w", selection.Path, err)
	}

	if config != nil && config.ExecProvider != nil {
		wrapExecProviderForWindows(config)
	}

	qps, burst := a.kubernetesClientRateLimits()
	config.QPS = float32(qps)
	config.Burst = burst
	config.RateLimiter = newMutableKubernetesRateLimiter(qps, burst)

	// Wrap transport once so diagnostics see real outbound Kubernetes requests,
	// then preserve the auth-aware layer for per-cluster auth state management.
	apiMetrics := a.ensureKubernetesAPIMetricsRegistry().getOrCreate(meta, qps, burst)
	existingWrap := config.WrapTransport
	config.WrapTransport = func(rt http.RoundTripper) http.RoundTripper {
		if existingWrap != nil {
			rt = existingWrap(rt)
		}
		rt = &kubernetesAPIMetricsTransport{base: rt, metrics: apiMetrics}
		if clusterAuthMgr != nil {
			rt = clusterAuthMgr.WrapTransport(rt)
		}
		return rt
	}

	return config, nil
}
