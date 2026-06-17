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

func (a *App) deletePod(clusterID, namespace, name string) error {
	if err := requirePodObject(namespace, name); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTarget(
			clusterID,
			"",
			"v1",
			pods.Identity.Kind,
			namespace,
			name,
		),
	})
	return err
}

func (a *App) deletePodAction(target ObjectActionTargetRef) error {
	if target.Group != "" || target.Version != "v1" || target.Kind != pods.Identity.Kind {
		return errUnsupportedActionTarget(ObjectActionDelete, target, "/v1", pods.Identity.Kind)
	}
	if err := requirePodObject(target.Namespace, target.Name); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Group:     target.Group,
		Version:   target.Version,
		Kind:      target.Kind,
		Namespace: target.Namespace,
		Name:      target.Name,
		Verb:      "delete",
	}); err != nil {
		return err
	}
	if err := pods.DeletePod(deps, target.Namespace, target.Name); err != nil {
		return err
	}
	a.invalidateResponseCacheForGVK(selectionKey, objectActionTargetGVK(target), target.Namespace, target.Name)
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

// createDebugContainer adds an ephemeral debug container to a running pod.
func (a *App) createDebugContainer(clusterID string, req DebugContainerRequest) (*DebugContainerResponse, error) {
	if err := requirePodObject(req.Namespace, req.PodName); err != nil {
		return nil, err
	}
	resp, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionCreateDebugContainer,
		Target: objectActionTarget(
			clusterID,
			"",
			"v1",
			pods.Identity.Kind,
			req.Namespace,
			req.PodName,
		),
		DebugContainer: &ObjectActionDebugContainerOptions{
			Image:           req.Image,
			TargetContainer: req.TargetContainer,
		},
	})
	if err != nil {
		return nil, err
	}
	return resp.DebugContainer, nil
}

func (a *App) createDebugContainerAction(target ObjectActionTargetRef, options ObjectActionDebugContainerOptions) (*DebugContainerResponse, error) {
	if target.Group != "" || target.Version != "v1" || target.Kind != pods.Identity.Kind {
		return nil, errUnsupportedActionTarget(ObjectActionCreateDebugContainer, target, "/v1", pods.Identity.Kind)
	}
	if err := requirePodObject(target.Namespace, target.Name); err != nil {
		return nil, err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return nil, err
	}
	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Group:       target.Group,
		Version:     target.Version,
		Kind:        target.Kind,
		Namespace:   target.Namespace,
		Name:        target.Name,
		Verb:        "update",
		Subresource: "ephemeralcontainers",
	}); err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	response, err := service.CreateDebugContainer(target.Namespace, target.Name, options.Image, options.TargetContainer)
	if err != nil {
		return nil, err
	}
	a.invalidateResponseCacheForGVK(selectionKey, objectActionTargetGVK(target), target.Namespace, target.Name)
	return response, nil
}
