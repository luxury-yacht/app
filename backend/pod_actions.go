/*
 * backend/resources_pods.go
 *
 * App-level pod resource wrappers.
 * - Bridges Wails handlers to pod services.
 * - Resolves cluster-scoped dependencies for pod actions.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/pods"

func (g *ResourceGateway) deletePodAction(target ObjectActionTargetRef) error {
	if target.Group != "" || target.Version != "v1" || target.Kind != pods.Identity.Kind {
		return errUnsupportedActionTarget(ObjectActionDelete, target, "/v1", pods.Identity.Kind)
	}
	if err := requirePodObject(target.Namespace, target.Name); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := g.CtxOrBackground()
	if err := g.requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Group:     target.Group,
		Version:   target.Version,
		Kind:      target.Kind,
		Namespace: target.Namespace,
		Name:      target.Name,
		Verb:      "delete",
	}); err != nil {
		return err
	}
	if err := pods.DeletePod(ctx, deps, target.Namespace, target.Name); err != nil {
		return err
	}
	g.invalidateResponseCacheForGVK(selectionKey, objectActionTargetGVK(target), target.Namespace, target.Name)
	return nil
}

func (g *ResourceGateway) createDebugContainerAction(target ObjectActionTargetRef, options ObjectActionDebugContainerOptions) (*DebugContainerResponse, error) {
	if target.Group != "" || target.Version != "v1" || target.Kind != pods.Identity.Kind {
		return nil, errUnsupportedActionTarget(ObjectActionCreateDebugContainer, target, "/v1", pods.Identity.Kind)
	}
	if err := requirePodObject(target.Namespace, target.Name); err != nil {
		return nil, err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return nil, err
	}
	ctx := g.CtxOrBackground()
	if err := g.requireResourcePermission(ctx, deps, resourcePermissionCheck{
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
	response, err := service.CreateDebugContainer(ctx, target.Namespace, target.Name, options.Image, options.TargetContainer)
	if err != nil {
		return nil, err
	}
	g.invalidateResponseCacheForGVK(selectionKey, objectActionTargetGVK(target), target.Namespace, target.Name)
	return response, nil
}
