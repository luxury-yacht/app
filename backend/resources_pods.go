package backend

import "github.com/luxury-yacht/app/backend/resources/pods"

func (a *App) GetPod(namespace string, name string, detailed bool) (*PodDetailInfo, error) {
	return pods.GetPod(pods.Dependencies{Common: a.resourceDependencies()}, namespace, name, detailed)
}

func (a *App) DeletePod(clusterID, namespace, name string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	return pods.DeletePod(pods.Dependencies{Common: deps}, namespace, name)
}

func (a *App) LogFetcher(clusterID string, req LogFetchRequest) LogFetchResponse {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return LogFetchResponse{Error: err.Error()}
	}
	service := pods.NewService(pods.Dependencies{Common: deps})
	return service.LogFetcher(req)
}

func (a *App) GetPodContainers(clusterID, namespace, podName string) ([]string, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewService(pods.Dependencies{Common: deps})
	return service.PodContainers(namespace, podName)
}
