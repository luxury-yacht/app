package backend

import (
	"fmt"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// clusterClients stores Kubernetes clients scoped to a specific cluster selection.
type clusterClients struct {
	meta                ClusterMeta
	kubeconfigPath      string
	kubeconfigContext   string
	client              kubernetes.Interface
	apiextensionsClient apiextensionsclientset.Interface
	dynamicClient       dynamic.Interface
	metricsClient       *metricsclient.Clientset
	restConfig          *rest.Config
}

// registerPrimaryClusterClient keeps the client pool aligned with the primary selection.
func (a *App) registerPrimaryClusterClient() {
	if a == nil || a.client == nil {
		return
	}
	meta := a.currentClusterMeta()
	if meta.ID == "" {
		return
	}

	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	if a.clusterClients == nil {
		a.clusterClients = make(map[string]*clusterClients)
	}
	a.clusterClients[meta.ID] = &clusterClients{
		meta:                meta,
		kubeconfigPath:      a.selectedKubeconfig,
		kubeconfigContext:   a.selectedContext,
		client:              a.client,
		apiextensionsClient: a.apiextensionsClient,
		dynamicClient:       a.dynamicClient,
		metricsClient:       a.metricsClient,
		restConfig:          a.restConfig,
	}
}

func (a *App) clusterClientsForID(clusterID string) *clusterClients {
	if a == nil || clusterID == "" {
		return nil
	}
	a.clusterClientsMu.Lock()
	defer a.clusterClientsMu.Unlock()
	return a.clusterClients[clusterID]
}

// syncClusterClientPool builds missing clients for the provided selections and drops stale entries.
func (a *App) syncClusterClientPool(selections []kubeconfigSelection) error {
	if a == nil {
		return fmt.Errorf("app is nil")
	}

	desired := make(map[string]kubeconfigSelection, len(selections))
	for _, sel := range selections {
		meta := a.clusterMetaForSelection(sel)
		if meta.ID == "" {
			continue
		}
		desired[meta.ID] = sel
	}

	var toCreate []kubeconfigSelection

	a.clusterClientsMu.Lock()
	if a.clusterClients == nil {
		a.clusterClients = make(map[string]*clusterClients)
	}
	for id, selection := range desired {
		if _, exists := a.clusterClients[id]; !exists {
			toCreate = append(toCreate, selection)
		}
	}
	a.clusterClientsMu.Unlock()

	for _, sel := range toCreate {
		meta := a.clusterMetaForSelection(sel)
		if meta.ID == "" {
			continue
		}
		clients, err := a.buildClusterClients(sel, meta)
		if err != nil {
			return err
		}

		a.clusterClientsMu.Lock()
		a.clusterClients[meta.ID] = clients
		a.clusterClientsMu.Unlock()
	}

	a.clusterClientsMu.Lock()
	for id := range a.clusterClients {
		if _, ok := desired[id]; !ok {
			delete(a.clusterClients, id)
		}
	}
	a.clusterClientsMu.Unlock()

	return nil
}

// buildClusterClients initializes client-go dependencies for a specific kubeconfig selection.
func (a *App) buildClusterClients(selection kubeconfigSelection, meta ClusterMeta) (*clusterClients, error) {
	config, err := a.buildRestConfigForSelection(selection)
	if err != nil {
		return nil, err
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	apiextensionsClient, err := apiextensionsclientset.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create apiextensions clientset: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	var metrics *metricsclient.Clientset
	metricsClient, err := metricsclient.NewForConfig(config)
	if err != nil {
		if a.logger != nil {
			a.logger.Info(fmt.Sprintf("Metrics client not available for cluster %s: %v", meta.ID, err), "KubernetesClient")
		}
	} else {
		metrics = metricsClient
	}

	return &clusterClients{
		meta:                meta,
		kubeconfigPath:      selection.Path,
		kubeconfigContext:   selection.Context,
		client:              clientset,
		apiextensionsClient: apiextensionsClient,
		dynamicClient:       dynamicClient,
		metricsClient:       metrics,
		restConfig:          config,
	}, nil
}

// buildRestConfigForSelection loads a REST config for the provided kubeconfig path/context.
func (a *App) buildRestConfigForSelection(selection kubeconfigSelection) (*rest.Config, error) {
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

	config.QPS = 500
	config.Burst = 1000

	return config, nil
}
