/*
 * backend/app_testing.go
*
 * Test helpers for application testing functionality.
 * These helpers are used by tests to configure the App with mock clients.
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

// InitializeForTesting sets up the app for testing with a provided Kubernetes client.
// It creates a test cluster entry in clusterClients so the app behaves as if
// a real cluster is connected. The client is stored only in the per-cluster
// clusterClients map - there are no global client fields.
// This is a standalone function (not a method) so Wails does not bind it.
func InitializeForTesting(a *App, ctx context.Context, client kubernetes.Interface) {
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
		// Create cluster clients with only the provided client.
		// Additional clients (apiextensions, dynamic, metrics, restConfig) can be set
		// using SetRestConfigForTest, SetMetricsClientForTest, etc. after this call.
		a.clusterClients[meta.ID] = &clusterClients{
			meta:              meta,
			kubeconfigPath:    selection.Path,
			kubeconfigContext: selection.Context,
			client:            client,
		}

		if err := a.setupRefreshSubsystem(); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to initialize refresh subsystem in tests: %v", err), "Refresh")
		} else {
			a.startObjectCatalog()
		}
	}
}

// SetRestConfigForTest sets the REST config for all cluster clients.
// This is a standalone function (not a method) so Wails does not bind it.
func SetRestConfigForTest(a *App, config *rest.Config) {
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil {
			clients.restConfig = config
		}
	}
	a.clusterClientsMu.Unlock()
}

// SetMetricsClientForTest sets the metrics client for all cluster clients.
// This is a standalone function (not a method) so Wails does not bind it.
func SetMetricsClientForTest(a *App, client *metricsclient.Clientset) {
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil {
			clients.metricsClient = client
		}
	}
	a.clusterClientsMu.Unlock()
}

// SetApiExtensionsClientForTest sets the API extensions client for all cluster clients.
// This is a standalone function (not a method) so Wails does not bind it.
func SetApiExtensionsClientForTest(a *App, client apiextensionsclientset.Interface) {
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil {
			clients.apiextensionsClient = client
		}
	}
	a.clusterClientsMu.Unlock()
}

// SetDynamicClientForTest sets the dynamic client for all cluster clients.
// This is a standalone function (not a method) so Wails does not bind it.
func SetDynamicClientForTest(a *App, client dynamic.Interface) {
	a.clusterClientsMu.Lock()
	for _, clients := range a.clusterClients {
		if clients != nil {
			clients.dynamicClient = client
		}
	}
	a.clusterClientsMu.Unlock()
}
