/*
 * backend/resources_generic.go
 *
 * App-level generic resource wrappers.
 * - Exposes generic delete handler by resource kind.
 */

package backend

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/resources/generic"
)

// deleteResourceByGVK removes a Kubernetes object identified by its
// fully-qualified apiVersion + kind. apiVersion must be in the standard
// Kubernetes "group/version" form (or just "version" for core resources
// like "v1"). Unlike DeleteResource, this path resolves the GVR strictly
// through the cluster's resource resolver so two CRDs that share a Kind don't
// get conflated.
func (a *App) deleteResourceByGVK(clusterID, apiVersion, kind, namespace, name string) error {
	gvk := schema.FromAPIVersionAndKind(strings.TrimSpace(apiVersion), strings.TrimSpace(kind))
	if gvk.Kind == "" {
		return fmt.Errorf("kind is required")
	}
	if gvk.Version == "" {
		return fmt.Errorf("apiVersion is required")
	}
	if err := requireObjectName(name); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTargetFromGVK(clusterID, gvk, namespace, name),
	})
	return err
}

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
