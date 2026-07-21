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

func (a *App) deleteGenericResourceAction(target ObjectActionTargetRef) error {
	if err := requireObjectName(target.Name); err != nil {
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
	service := generic.NewService(deps)
	if err := service.DeleteByGVK(objectActionTargetGVK(target), target.Namespace, target.Name); err != nil {
		return err
	}
	a.invalidateResponseCacheForGVK(selectionKey, objectActionTargetGVK(target), target.Namespace, target.Name)
	return nil
}
