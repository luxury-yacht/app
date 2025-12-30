package backend

import (
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/workloads"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

type WorkloadInfo = workloads.WorkloadInfo

func (a *App) GetDeployment(namespace, name string) (*DeploymentDetails, error) {
	deps := workloads.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "Deployment", namespace, name, func() (*DeploymentDetails, error) {
		return workloads.NewDeploymentService(deps).Deployment(namespace, name)
	})
}

// GetReplicaSet returns the detailed view for a ReplicaSet.
func (a *App) GetReplicaSet(namespace, name string) (*ReplicaSetDetails, error) {
	deps := workloads.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "ReplicaSet", namespace, name, func() (*ReplicaSetDetails, error) {
		return workloads.NewReplicaSetService(deps).ReplicaSet(namespace, name)
	})
}

func (a *App) GetStatefulSet(namespace, name string) (*StatefulSetDetails, error) {
	deps := workloads.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "StatefulSet", namespace, name, func() (*StatefulSetDetails, error) {
		return workloads.NewStatefulSetService(deps).StatefulSet(namespace, name)
	})
}

func (a *App) GetDaemonSet(namespace, name string) (*DaemonSetDetails, error) {
	deps := workloads.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "DaemonSet", namespace, name, func() (*DaemonSetDetails, error) {
		return workloads.NewDaemonSetService(deps).DaemonSet(namespace, name)
	})
}

func (a *App) GetJob(namespace, name string) (*JobDetails, error) {
	deps := workloads.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "Job", namespace, name, func() (*JobDetails, error) {
		return workloads.NewJobService(deps).Job(namespace, name)
	})
}

func (a *App) GetCronJob(namespace, name string) (*CronJobDetails, error) {
	deps := workloads.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "CronJob", namespace, name, func() (*CronJobDetails, error) {
		return workloads.NewCronJobService(deps).CronJob(namespace, name)
	})
}

func (a *App) GetWorkloads(namespace string, clientVersion string) (*VersionedResponse, error) {
	workloadsData, err := workloads.GetWorkloads(workloads.Dependencies{
		Common: a.resourceDependencies(),
	}, namespace)
	if err != nil {
		return nil, err
	}

	cacheKey := "workloads:" + namespace
	version, notModified, err := a.versionCache.CheckAndUpdate(cacheKey, workloadsData, clientVersion)
	if err != nil {
		return nil, err
	}
	if notModified {
		return &VersionedResponse{Version: version, NotModified: true}, nil
	}
	return &VersionedResponse{Data: workloadsData, Version: version}, nil
}

func (a *App) resourceDependencies() common.Dependencies {
	// Ensure nil pointer metrics clients don't get wrapped in non-nil interfaces.
	var metricsClient metricsclient.Interface
	if a.metricsClient != nil {
		metricsClient = a.metricsClient
	}

	return common.Dependencies{
		Context:          a.Ctx,
		Logger:           a.logger,
		KubernetesClient: a.client,
		MetricsClient:    metricsClient,
		SetMetricsClient: func(mc metricsclient.Interface) {
			if clientset, ok := mc.(*metricsclient.Clientset); ok {
				a.metricsClient = clientset
			}
		},
		DynamicClient:       a.dynamicClient,
		APIExtensionsClient: a.apiextensionsClient,
		RestConfig:          a.restConfig,
		EnsureClient:        a.ensureClientInitialized,
		EnsureAPIExtensions: a.ensureAPIExtensionsClientInitialized,
		SelectedKubeconfig:  a.selectedKubeconfig,
		SelectedContext:     a.selectedContext,
	}
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
