/*
 * backend/resources_workloads.go
 *
 * App-level workload resource wrappers.
 * - Exposes workload detail handlers.
 */

package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// resourceDependenciesForSelection returns dependencies scoped to a specific cluster selection.
func (a *App) resourceDependenciesForSelection(selection kubeconfigSelection, clients *clusterClients, clusterID string) common.Dependencies {
	// Ensure nil pointer metrics clients don't get wrapped in non-nil interfaces.
	var metricsClient metricsclient.Interface
	if clients != nil && clients.metricsClient != nil {
		metricsClient = clients.metricsClient
	}

	deps := common.Dependencies{
		Context:             a.Ctx,
		Logger:              a.logger,
		KubernetesClient:    nil,
		MetricsClient:       metricsClient,
		DynamicClient:       nil,
		APIExtensionsClient: nil,
		RestConfig:          nil,
		ResourceResolver:    appResourceResolver{app: a, clusterID: clusterID},
		SelectedKubeconfig:  selection.Path,
		SelectedContext:     selection.Context,
		ClusterID:           clusterID,
	}

	if clients == nil {
		deps.Logger = applog.ClusterScoped(deps.Logger, deps.ClusterID, deps.ClusterName)
		return deps
	}

	// Populate cluster name from clients metadata if available.
	if clients.meta.Name != "" {
		deps.ClusterName = clients.meta.Name
	}
	deps.Logger = applog.ClusterScoped(deps.Logger, deps.ClusterID, deps.ClusterName)

	deps.KubernetesClient = clients.client
	deps.GatewayClient = clients.gatewayClient
	deps.GatewayAPIPresence = clients.gatewayAPIPresence
	deps.GatewayVersionResolver = clients.gatewayVersionResolver
	deps.DynamicClient = clients.dynamicClient
	deps.APIExtensionsClient = clients.apiextensionsClient
	deps.RestConfig = clients.restConfig
	deps.EnsureClient = func(resourceKind string) error {
		if deps.KubernetesClient == nil {
			applog.Error(deps.Logger, fmt.Sprintf("Kubernetes client not initialized for %s fetch", resourceKind), logsources.ResourceLoader)
			return fmt.Errorf("kubernetes client not initialized")
		}
		return nil
	}
	deps.EnsureAPIExtensions = func(resourceKind string) error {
		if deps.APIExtensionsClient == nil {
			applog.Error(deps.Logger, fmt.Sprintf("API extensions client not initialized for %s fetch", resourceKind), logsources.ResourceLoader)
			return fmt.Errorf("apiextensions client not initialized")
		}
		return nil
	}
	deps.SetMetricsClient = func(mc metricsclient.Interface) {
		clientset, ok := mc.(*metricsclient.Clientset)
		if !ok {
			return
		}
		a.clusterClientsMu.Lock()
		defer a.clusterClientsMu.Unlock()
		entry := a.clusterClients[clusterID]
		if entry != nil {
			entry.metricsClient = clientset
		}
	}

	return deps
}
