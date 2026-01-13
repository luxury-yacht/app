/*
 * backend/resources_workloads.go
 *
 * App-level workload resource wrappers.
 * - Exposes workload detail handlers and aggregated listings.
 */

package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/workloads"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

type WorkloadInfo = workloads.WorkloadInfo

func (a *App) GetDeployment(clusterID, namespace, name string) (*DeploymentDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "Deployment", namespace, name, func() (*DeploymentDetails, error) {
		return workloads.NewDeploymentService(deps).Deployment(namespace, name)
	})
}

// GetReplicaSet returns the detailed view for a ReplicaSet.
func (a *App) GetReplicaSet(clusterID, namespace, name string) (*ReplicaSetDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "ReplicaSet", namespace, name, func() (*ReplicaSetDetails, error) {
		return workloads.NewReplicaSetService(deps).ReplicaSet(namespace, name)
	})
}

func (a *App) GetStatefulSet(clusterID, namespace, name string) (*StatefulSetDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "StatefulSet", namespace, name, func() (*StatefulSetDetails, error) {
		return workloads.NewStatefulSetService(deps).StatefulSet(namespace, name)
	})
}

func (a *App) GetDaemonSet(clusterID, namespace, name string) (*DaemonSetDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "DaemonSet", namespace, name, func() (*DaemonSetDetails, error) {
		return workloads.NewDaemonSetService(deps).DaemonSet(namespace, name)
	})
}

func (a *App) GetJob(clusterID, namespace, name string) (*JobDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "Job", namespace, name, func() (*JobDetails, error) {
		return workloads.NewJobService(deps).Job(namespace, name)
	})
}

func (a *App) GetCronJob(clusterID, namespace, name string) (*CronJobDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "CronJob", namespace, name, func() (*CronJobDetails, error) {
		return workloads.NewCronJobService(deps).CronJob(namespace, name)
	})
}

func (a *App) GetWorkloads(clusterID, namespace string, clientVersion string) (*VersionedResponse, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	workloadsData, err := workloads.GetWorkloads(deps, namespace)
	if err != nil {
		return nil, err
	}

	cacheKey := "workloads:" + selectionKey + ":" + namespace
	version, notModified, err := a.versionCache.CheckAndUpdate(cacheKey, workloadsData, clientVersion)
	if err != nil {
		return nil, err
	}
	if notModified {
		return &VersionedResponse{Version: version, NotModified: true}, nil
	}
	return &VersionedResponse{Data: workloadsData, Version: version}, nil
}

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
		SelectedKubeconfig:  selection.Path,
		SelectedContext:     selection.Context,
	}

	if clients == nil {
		return deps
	}

	deps.KubernetesClient = clients.client
	deps.DynamicClient = clients.dynamicClient
	deps.APIExtensionsClient = clients.apiextensionsClient
	deps.RestConfig = clients.restConfig
	deps.EnsureClient = func(resourceKind string) error {
		if deps.KubernetesClient == nil {
			if a.logger != nil {
				a.logger.Error(fmt.Sprintf("Kubernetes client not initialized for %s fetch", resourceKind), "ResourceLoader")
			}
			return fmt.Errorf("kubernetes client not initialized")
		}
		return nil
	}
	deps.EnsureAPIExtensions = func(resourceKind string) error {
		if deps.APIExtensionsClient == nil {
			if a.logger != nil {
				a.logger.Error(fmt.Sprintf("API extensions client not initialized for %s fetch", resourceKind), "ResourceLoader")
			}
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
