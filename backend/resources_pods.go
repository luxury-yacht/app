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
	if err := requirePodObject(namespace, name); err != nil {
		return nil, err
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return pods.GetPod(deps, namespace, name, detailed)
}

func (a *App) DeletePod(clusterID, namespace, name string) error {
	if err := requirePodObject(namespace, name); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Kind:      "Pod",
		Namespace: namespace,
		Name:      name,
		Verb:      "delete",
	}); err != nil {
		return err
	}
	if err := pods.DeletePod(deps, namespace, name); err != nil {
		return err
	}
	a.invalidateResponseCache(selectionKey, "Pod", namespace, name)
	return nil
}

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

// CreateDebugContainer adds an ephemeral debug container to a running pod.
func (a *App) CreateDebugContainer(clusterID string, req DebugContainerRequest) (*DebugContainerResponse, error) {
	if err := requirePodObject(req.Namespace, req.PodName); err != nil {
		return nil, err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Kind:        "Pod",
		Namespace:   req.Namespace,
		Name:        req.PodName,
		Verb:        "update",
		Subresource: "ephemeralcontainers",
	}); err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	response, err := service.CreateDebugContainer(req.Namespace, req.PodName, req.Image, req.TargetContainer)
	if err != nil {
		return nil, err
	}
	a.invalidateResponseCache(selectionKey, "Pod", req.Namespace, req.PodName)
	return response, nil
}
