/*
 * backend/resources_helm.go
 *
 * App-level Helm resource wrappers.
 * - Fetches Helm release details, manifests, and values.
 */

package backend

import (
	"strings"

	configmappkg "github.com/luxury-yacht/app/backend/resources/configmap"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"

	"github.com/luxury-yacht/app/backend/resources/helm"
)

func (a *App) deleteHelmRelease(clusterID, namespace, name string) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionDelete,
		Target: objectActionTarget(
			clusterID,
			"helm.sh",
			"v3",
			"HelmRelease",
			namespace,
			name,
		),
	})
	return err
}
func (a *App) deleteHelmReleaseAction(target ObjectActionTargetRef) error {
	if target.Group != "helm.sh" || target.Version != "v3" || !strings.EqualFold(target.Kind, "HelmRelease") {
		return errUnsupportedActionTarget(ObjectActionDelete, target, "helm.sh/v3", "HelmRelease")
	}
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	if err := a.requireAnyResourcePermission(deps.Context, deps,
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
	_, err = FetchResourceWithSelection(a, selectionKey, "", "HelmDelete", target.Namespace+"/"+target.Name, func() (struct{}, error) {
		service := helm.NewService(helm.Dependencies{Common: deps})
		return struct{}{}, service.DeleteRelease(target.Namespace, target.Name)
	})
	if err != nil {
		return err
	}
	a.invalidateHelmCache(selectionKey, target.Namespace, target.Name)
	return nil
}
