/*
 * backend/resources_helm.go
 *
 * App-level Helm resource wrappers.
 * - Fetches Helm release details, manifests, and values.
 */

package backend

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resources/helm"
)

func (a *App) GetHelmReleaseDetails(clusterID, namespace, name string) (*HelmReleaseDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	helmDeps := helm.Dependencies{Common: deps}
	return FetchNamespacedResource(a, deps, selectionKey, "HelmRelease", namespace, name, func() (*HelmReleaseDetails, error) {
		return helm.NewService(helmDeps).ReleaseDetails(namespace, name)
	})
}

func (a *App) GetHelmManifest(clusterID, namespace, name string) (string, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return "", err
	}
	helmDeps := helm.Dependencies{Common: deps}
	return FetchNamespacedResource(a, deps, selectionKey, "HelmManifest", namespace, name, func() (string, error) {
		return helm.NewService(helmDeps).ReleaseManifest(namespace, name)
	})
}

func (a *App) GetHelmValues(clusterID, namespace, name string) (map[string]interface{}, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	helmDeps := helm.Dependencies{Common: deps}
	return FetchNamespacedResource(a, deps, selectionKey, "HelmValues", namespace, name, func() (map[string]interface{}, error) {
		return helm.NewService(helmDeps).ReleaseValues(namespace, name)
	})
}

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
			Kind:      "Secret",
			Namespace: target.Namespace,
			Verb:      "delete",
		},
		resourcePermissionCheck{
			Version:   "v1",
			Kind:      "ConfigMap",
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
