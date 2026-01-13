/*
 * backend/app_testing.go
*
 * Tests for application testing functionality.
*/

package backend

import (
	"context"
	"fmt"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

func (a *App) InitializeForTesting(ctx context.Context, client kubernetes.Interface) {
	a.Ctx = ctx
	if a.logger == nil {
		a.logger = NewLogger(1000)
	}
	if client != nil {
		// Seed a deterministic test selection so refresh wiring stays cluster-scoped.
		selection := kubeconfigSelection{Path: "/test/kubeconfig", Context: "test"}
		meta := ClusterMeta{ID: "test:test", Name: "test"}
		a.availableKubeconfigs = []KubeconfigInfo{{
			Name:    "test",
			Path:    selection.Path,
			Context: selection.Context,
		}}
		a.selectedKubeconfigs = []string{selection.String()}
		if a.clusterClients == nil {
			a.clusterClients = make(map[string]*clusterClients)
		}
		a.clusterClients[meta.ID] = &clusterClients{
			meta:                meta,
			kubeconfigPath:      selection.Path,
			kubeconfigContext:   selection.Context,
			client:              client,
			apiextensionsClient: a.apiextensionsClient,
			dynamicClient:       a.dynamicClient,
			metricsClient:       a.metricsClient,
			restConfig:          a.restConfig,
		}

		if err := a.setupRefreshSubsystem(); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to initialize refresh subsystem in tests: %v", err), "Refresh")
		} else {
			a.startObjectCatalog()
		}
	}
}

func (a *App) SetRestConfig(config *rest.Config) {
	a.restConfig = config
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil {
			clients.restConfig = config
		}
	}
	a.clusterClientsMu.Unlock()
}

func (a *App) SetMetricsClient(client *metricsclient.Clientset) {
	a.metricsClient = client
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil {
			clients.metricsClient = client
		}
	}
	a.clusterClientsMu.Unlock()
}

func (a *App) SetApiExtensionsClient(client *apiextensionsclientset.Clientset) {
	a.apiextensionsClient = client
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil {
			clients.apiextensionsClient = client
		}
	}
	a.clusterClientsMu.Unlock()
}

func (a *App) SetDynamicClient(client dynamic.Interface) {
	a.dynamicClient = client
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil {
			clients.dynamicClient = client
		}
	}
	a.clusterClientsMu.Unlock()
}
