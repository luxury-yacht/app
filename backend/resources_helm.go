/*
 * backend/resources_helm.go
 *
 * App-level Helm resource wrappers.
 * - Fetches Helm release details, manifests, and values.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/helm"

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

func (a *App) DeleteHelmRelease(clusterID, namespace, name string) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if err := a.requireAnyResourcePermission(deps.Context, deps,
		resourcePermissionCheck{
			Kind:      "Secret",
			Namespace: namespace,
			Verb:      "delete",
		},
		resourcePermissionCheck{
			Kind:      "ConfigMap",
			Namespace: namespace,
			Verb:      "delete",
		},
	); err != nil {
		return err
	}
	_, err = FetchResourceWithSelection(a, selectionKey, "", "HelmDelete", namespace+"/"+name, func() (struct{}, error) {
		service := helm.NewService(helm.Dependencies{Common: deps})
		return struct{}{}, service.DeleteRelease(namespace, name)
	})
	if err != nil {
		return err
	}
	a.invalidateHelmCache(selectionKey, namespace, name)
	return nil
}
