/*
 * backend/helm_actions.go
 *
 * Helm release object actions.
 */

package backend

import (
	configmappkg "github.com/luxury-yacht/app/backend/resources/configmap"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/helm"
)

func (g *ResourceGateway) deleteHelmReleaseAction(target ObjectActionTargetRef) error {
	if !resourcemodel.IsHelmReleaseGVK(objectActionTargetGVK(target)) {
		return errUnsupportedActionTarget(ObjectActionDelete, target, resourcemodel.HelmReleaseGVK.GroupVersion().String(), resourcemodel.HelmReleaseGVK.Kind)
	}
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := g.CtxOrBackground()
	if err := requireAnyResourcePermission(ctx, deps,
		resourcePermissionCheck{
			Version:   "v1",
			Kind:      secretpkg.Identity.Kind,
			Namespace: target.Namespace,
			Verb:      "delete",
		},
		resourcePermissionCheck{
			Version:   "v1",
			Kind:      configmappkg.Identity.Kind,
			Namespace: target.Namespace,
			Verb:      "delete",
		},
	); err != nil {
		return err
	}
	if err := helm.NewService(helm.Dependencies{Common: deps}).DeleteRelease(target.Namespace, target.Name); err != nil {
		return err
	}
	g.invalidateHelmCache(selectionKey, target.Namespace, target.Name)
	return nil
}
