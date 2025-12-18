package backend

import "github.com/luxury-yacht/app/backend/resources/pods"

func (a *App) GetPod(namespace string, name string, detailed bool) (*PodDetailInfo, error) {
	return pods.GetPod(pods.Dependencies{Common: a.resourceDependencies()}, namespace, name, detailed)
}

func (a *App) DeletePod(namespace, name string) error {
	return pods.DeletePod(pods.Dependencies{Common: a.resourceDependencies()}, namespace, name)
}

func (a *App) LogFetcher(req LogFetchRequest) LogFetchResponse {
	service := pods.NewService(pods.Dependencies{Common: a.resourceDependencies()})
	return service.LogFetcher(req)
}

func (a *App) GetPodContainers(namespace, podName string) ([]string, error) {
	service := pods.NewService(pods.Dependencies{Common: a.resourceDependencies()})
	return service.PodContainers(namespace, podName)
}
