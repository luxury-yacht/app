/*
 * backend/resources_pods.go
 *
 * App-level pod resource wrappers.
 * - Bridges Wails handlers to pod services.
 * - Resolves cluster-scoped dependencies for pod actions.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/pods"

func (a *App) FetchContainerLogs(clusterID string, req ContainerLogsFetchRequest) ContainerLogsFetchResponse {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return ContainerLogsFetchResponse{Error: err.Error()}
	}
	service := pods.NewService(deps)
	return service.FetchContainerLogs(req)
}
func (a *App) GetPodContainers(clusterID, namespace, podName string) ([]string, error) {
	if err := requirePodObject(namespace, podName); err != nil {
		return nil, err
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	return service.PodContainers(namespace, podName)
}
func (a *App) GetContainerLogsScopeContainers(clusterID, scope string) ([]string, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	return service.ContainerLogsScopeContainers(scope)
}
