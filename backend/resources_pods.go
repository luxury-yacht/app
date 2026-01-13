/*
 * backend/resources_pods.go
 *
 * App-level pod resource wrappers.
 * - Bridges Wails handlers to pod services.
 * - Resolves cluster-scoped dependencies for pod actions.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/pods"

func (a *App) GetPod(clusterID, namespace, name string, detailed bool) (*PodDetailInfo, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return pods.GetPod(deps, namespace, name, detailed)
}

func (a *App) DeletePod(clusterID, namespace, name string) error {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	return pods.DeletePod(deps, namespace, name)
}

func (a *App) LogFetcher(clusterID string, req LogFetchRequest) LogFetchResponse {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return LogFetchResponse{Error: err.Error()}
	}
	service := pods.NewService(deps)
	return service.LogFetcher(req)
}

func (a *App) GetPodContainers(clusterID, namespace, podName string) ([]string, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	return service.PodContainers(namespace, podName)
}
