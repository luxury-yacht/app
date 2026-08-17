/*
 * backend/resources_generic.go
 *
 * App-level generic resource wrappers.
 * - Exposes generic delete handler by resource kind.
 */

package backend

import (
	"github.com/luxury-yacht/app/backend/resources/generic"
)

func (g *ResourceGateway) deleteGenericResourceAction(target ObjectActionTargetRef) error {
	if err := requireObjectName(target.Name); err != nil {
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
	service := generic.NewService(deps)
	if err := service.DeleteByGVK(ctx, objectActionTargetGVK(target), target.Namespace, target.Name); err != nil {
		return err
	}
	g.invalidateResponseCacheForGVK(selectionKey, objectActionTargetGVK(target), target.Namespace, target.Name)
	return nil
}
