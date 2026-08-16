package backend

import (
	"context"
	"fmt"
	"net/http"
	"runtime"

	appconfig "github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	informerpkg "github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
	gatewayversioned "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
)

// clusterClients stores Kubernetes clients scoped to a specific cluster selection.
type clusterClients struct {
	meta                   ClusterMeta
	kubeconfigPath         string
	kubeconfigContext      string
	client                 kubernetes.Interface
	gatewayClient          gatewayversioned.Interface
	gatewayInformerFactory gatewayinformers.SharedInformerFactory
	gatewayAPIPresence     common.GatewayAPIPresence
	gatewayVersionResolver common.VersionResolver
	apiextensionsClient    apiextensionsclientset.Interface
	dynamicClient          dynamic.Interface
	metricsClient          *metricsclient.Clientset
	restConfig             *rest.Config
	rateLimiter            *mutableKubernetesRateLimiter
	// authManager provides per-cluster auth state tracking and recovery.
	// Each cluster has its own auth manager so that auth failures in one
	// cluster don't affect other clusters.
	authManager *authstate.Manager
	// authFailedOnInit is true if the pre-flight credential check failed
	// during client initialization. Used to skip subsystem creation.
	authFailedOnInit bool
	// fallbackResourceResolver is used only before the object catalog service is
	// available. It avoids rebuilding the built-in identity seed on every
	// cold-start lookup.
	fallbackResourceResolver common.ResourceResolver
}

type builtClusterClientDependencies struct {
	client                 kubernetes.Interface
	gatewayClient          gatewayversioned.Interface
	gatewayInformerFactory gatewayinformers.SharedInformerFactory
	gatewayAPIPresence     *gatewayapi.Presence
	apiextensionsClient    apiextensionsclientset.Interface
	dynamicClient          dynamic.Interface
	metricsClient          *metricsclient.Clientset
}

type clusterClientBuilder func(
	context.Context,
	kubeconfigSelection,
	ClusterMeta,
) (*clusterClients, error)

// setClusterClientLocked commits one client-map entry and its workspace
// revision together. The caller must hold clusterClientsMu.
func (a *App) setClusterClientLocked(clusterID string, clients *clusterClients) {
	if a.clusterClients == nil {
		a.clusterClients = make(map[string]*clusterClients)
	}
	a.clusterClients[clusterID] = clients
	a.markClusterWorkspaceChanged()
}

// removeClusterClientLocked removes one client-map entry. The caller must hold
// clusterClientsMu.
func (a *App) removeClusterClientLocked(clusterID string) (*clusterClients, bool) {
	clients, ok := a.clusterClients[clusterID]
	if !ok {
		return nil, false
	}
	delete(a.clusterClients, clusterID)
	a.markClusterWorkspaceChanged()
	return clients, true
}

// clearClusterClientsLocked removes every client-map entry. The caller must
// hold clusterClientsMu.
func (a *App) clearClusterClientsLocked() {
	if len(a.clusterClients) == 0 {
		return
	}
	a.clusterClients = make(map[string]*clusterClients)
	a.markClusterWorkspaceChanged()
}

func (a *App) clusterClientsForID(clusterID string) *clusterClients {
	if a == nil || clusterID == "" {
		return nil
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	return a.clusterClients[clusterID]
}

// clusterClientsForSelection finds stored clients by matching the kubeconfig path
// and context, regardless of what ID was derived. This handles cases where
// clusterMetaForSelection re-derives a different ID than what was used at build time.
func (a *App) clusterClientsForSelection(selection kubeconfigSelection) *clusterClients {
	if a == nil {
		return nil
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	return a.clusterClientsForSelectionLocked(selection)
}

func (a *App) clusterClientsForSelectionLocked(selection kubeconfigSelection) *clusterClients {
	for _, c := range a.clusterClients {
		if c != nil && c.kubeconfigPath == selection.Path && c.kubeconfigContext == selection.Context {
			return c
		}
	}
	return nil
}

// syncClusterClientPool builds missing clients for the provided selections and drops stale entries.
func (a *App) syncClusterClientPool(selections []kubeconfigSelection) error {
	return a.syncClusterClientPoolWithContext(context.Background(), selections)
}

// syncClusterClientPoolWithContext builds missing clients for the provided selections and drops stale entries.
func (a *App) syncClusterClientPoolWithContext(ctx context.Context, selections []kubeconfigSelection) error {
	return a.syncClusterClientPoolWithBuilder(ctx, selections, a.buildClusterClientsWithContext)
}

func (a *App) syncClusterClientPoolWithBuilder(
	ctx context.Context,
	selections []kubeconfigSelection,
	build clusterClientBuilder,
) error {
	ctx, err := validateClusterClientSync(a, ctx, build)
	if err != nil {
		return err
	}
	desired := a.desiredClusterClientSelections(selections)
	tasks := a.clusterClientCreateTasks(desired)
	if err := a.createClusterClients(ctx, tasks, build); err != nil {
		return err
	}
	a.cleanupRemovedClusterClients(a.removeUndesiredClusterClients(desired))
	return nil
}

type clusterClientCreateTask struct {
	selection kubeconfigSelection
	meta      ClusterMeta
}

type removedClusterClient struct {
	clusterID   string
	authManager interface{ Shutdown() }
}

func validateClusterClientSync(a *App, ctx context.Context, build clusterClientBuilder) (context.Context, error) {
	if a == nil {
		return nil, fmt.Errorf("app is nil")
	}
	if build == nil {
		return nil, fmt.Errorf("cluster client builder is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return ctx, nil
}

func (a *App) desiredClusterClientSelections(selections []kubeconfigSelection) map[string]kubeconfigSelection {
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

func (a *App) clusterClientCreateTasks(desired map[string]kubeconfigSelection) []clusterClientCreateTask {
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

func (a *App) createClusterClients(ctx context.Context, tasks []clusterClientCreateTask, build clusterClientBuilder) error {
	a.markClusterClientTasksConnecting(tasks)
	limit := clusterClientBuildConcurrencyLimit(len(tasks))
	return parallel.ForEach(ctx, tasks, limit, func(taskCtx context.Context, task clusterClientCreateTask) error {
		return a.runClusterOperation(taskCtx, task.meta.ID, func(opCtx context.Context) error {
			return a.buildAndInstallClusterClient(opCtx, task, build)
		})
	})
}

func (a *App) markClusterClientTasksConnecting(tasks []clusterClientCreateTask) {
	if a.clusterLifecycle == nil {
		return
	}
	for _, task := range tasks {
		a.clusterLifecycle.SetState(task.meta.ID, ClusterStateConnecting)
	}
}

func (a *App) buildAndInstallClusterClient(ctx context.Context, task clusterClientCreateTask, build clusterClientBuilder) error {
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

func (a *App) clusterClientAlreadyInstalled(task clusterClientCreateTask) bool {
	return a.clusterClientsForID(task.meta.ID) != nil || a.clusterClientsForSelection(task.selection) != nil
}

func shutdownClusterClientAuthManager(clients *clusterClients) {
	if clients != nil && clients.authManager != nil {
		clients.authManager.Shutdown()
	}
}

func (a *App) installClusterClient(task clusterClientCreateTask, clients *clusterClients) bool {
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	if a.clusterClients[task.meta.ID] != nil || a.clusterClientsForSelectionLocked(task.selection) != nil {
		return false
	}
	a.setClusterClientLocked(task.meta.ID, clients)
	return true
}

func (a *App) removeUndesiredClusterClients(desired map[string]kubeconfigSelection) []removedClusterClient {
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

func clusterClientAuthManager(clients *clusterClients) interface{ Shutdown() } {
	if clients == nil || clients.authManager == nil {
		return nil
	}
	return clients.authManager
}

func (a *App) cleanupRemovedClusterClients(removed []removedClusterClient) {
	for _, item := range removed {
		if item.authManager != nil {
			item.authManager.Shutdown()
		}
	}
	for _, item := range removed {
		if a.operations != nil {
			a.operations.StopCluster(item.clusterID)
		}
	}
	for _, item := range removed {
		a.ensureKubernetesAPIMetricsRegistry().remove(item.clusterID)
		a.removeClusterWorkspaceState(item.clusterID)
	}
}

// clusterClientBuildConcurrencyLimit derives a bounded parallelism level for
// per-selection client initialization. Work is network-bound (discovery/auth).
func clusterClientBuildConcurrencyLimit(taskCount int) int {
	if taskCount <= 1 {
		return taskCount
	}
	limit := runtime.GOMAXPROCS(0)
	if limit <= 0 {
		limit = 1
	}
	if taskCount < limit {
		return taskCount
	}
	return limit
}

func (a *App) applyKubernetesClientRateLimits(qps, burst int) {
	if a == nil {
		return
	}
	qps = clampKubernetesClientQPS(qps)
	burst = clampKubernetesClientBurst(burst)

	a.clusterClientsMu.Lock()
	clients := make([]*clusterClients, 0, len(a.clusterClients))
	for _, item := range a.clusterClients {
		if item != nil {
			clients = append(clients, item)
		}
	}
	a.clusterClientsMu.Unlock()

	registry := a.ensureKubernetesAPIMetricsRegistry()
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

// buildClusterClientsWithContext initializes client-go dependencies for a specific kubeconfig selection.
// The preflight check is context-bound so superseding selection generations can preempt stale work.
func (a *App) buildClusterClientsWithContext(
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
func (a *App) buildClusterClientsWithManager(
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

func shutdownClusterAuthManagerIfOwned(manager *authstate.Manager, owned bool) {
	if owned {
		manager.Shutdown()
	}
}

func (a *App) buildClusterClientDependencies(
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

func (a *App) buildMetricsClient(config *rest.Config, meta ClusterMeta) *metricsclient.Clientset {
	client, err := metricsclient.NewForConfig(config)
	if err != nil {
		a.logger.Info(fmt.Sprintf("Metrics client not available for cluster %s: %v", meta.ID, err), logsources.KubernetesClient, meta.ID, meta.Name)
		return nil
	}
	return client
}

func (a *App) buildGatewayClients(
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

// configureClusterRecoveryTest rebuilds credentials rather than probing with a
// clientset that may still cache credentials from the failed request.
func configureClusterRecoveryTest(manager *authstate.Manager, selection kubeconfigSelection) {
	manager.SetRecoveryTest(func() error {
		loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
		loadingRules.ExplicitPath = selection.Path
		overrides := &clientcmd.ConfigOverrides{}
		if selection.Context != "" {
			overrides.CurrentContext = selection.Context
		}
		clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)
		freshConfig, err := clientConfig.ClientConfig()
		if err != nil {
			return fmt.Errorf("failed to load kubeconfig: %w", err)
		}
		freshConfig.Timeout = appconfig.ClusterAuthRecoveryProbeTimeout

		freshClient, err := kubernetes.NewForConfig(freshConfig)
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		_, err = freshClient.Discovery().ServerVersion()
		return err
	})
}

func (a *App) clusterAuthFailedOnPreflight(
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

func (a *App) preflightClusterClientWithContext(ctx context.Context, client kubernetes.Interface) error {
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
func (a *App) createClusterAuthManager(meta ClusterMeta) *authstate.Manager {
	return authstate.New(authstate.Config{
		MaxAttempts:               authstate.DefaultMaxAttempts,
		BackoffSchedule:           authstate.DefaultBackoffSchedule,
		ClassifyError:             classifyRecoveryError,
		ConnectivityRetryInterval: appconfig.ClusterAuthConnectivityRetryInterval,
		SteadyRetryInterval:       appconfig.ClusterAuthSteadyRetryInterval,
		OnStateChange: func(state authstate.State, diag authstate.FailureDiagnostic) {
			a.handleClusterAuthStateChange(meta.ID, state, diag)
		},
		OnRecoveryProgress: func(progress authstate.RecoveryProgress) {
			a.handleClusterAuthRecoveryProgress(meta.ID, progress)
		},
		OnSnapshotChange: a.markClusterWorkspaceChanged,
		// RecoveryTest is set later once we have the clientset
	})
}

// classifyRecoveryError maps a recovery probe failure to an auth or
// connectivity verdict. Only errors proving the cluster rejected the
// credentials — an HTTP 401/403 or a failed exec credential plugin — are
// auth-class and consume recovery attempts. Everything else (connection
// refused, timeouts, DNS, TLS) means the cluster could not be reached, which
// says nothing about credential validity, so the recovery loop keeps probing.
func classifyRecoveryError(err error) authstate.ErrorClass {
	switch credentialerrors.Classify(err, credentialerrors.Context{}).Class {
	case credentialerrors.ClassAuth:
		return authstate.ErrorClassAuth
	case credentialerrors.ClassConnectivity:
		return authstate.ErrorClassConnectivity
	default:
		return authstate.ErrorClassUnknown
	}
}

// buildRestConfigForSelection loads a REST config for the provided kubeconfig path/context.
// The clusterAuthMgr parameter is the per-cluster auth manager that will be used to wrap
// protobufRestConfig returns a COPY of base that negotiates Protobuf for built-in
// kinds: the Accept header offers protobuf-then-JSON, so the server picks protobuf
// where it can (every conformant apiserver serves it for built-ins — the control
// plane itself speaks it) and answers JSON where it cannot (third-party aggregated
// APIs) — the fallback is byte-for-byte the old behavior. Copying keeps the shared
// base config pristine for the dynamic and gateway clients, whose custom resources
// are JSON-only.
func protobufRestConfig(base *rest.Config) *rest.Config {
	cfg := rest.CopyConfig(base)
	cfg.AcceptContentTypes = "application/vnd.kubernetes.protobuf,application/json"
	cfg.ContentType = "application/vnd.kubernetes.protobuf"
	return cfg
}

// the transport for auth state tracking.
func (a *App) buildRestConfigForSelection(selection kubeconfigSelection, meta ClusterMeta, clusterAuthMgr *authstate.Manager) (*rest.Config, error) {
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
