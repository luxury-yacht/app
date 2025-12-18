package backend

import "github.com/luxury-yacht/app/backend/resources/helm"

func (a *App) GetHelmReleaseDetails(namespace, name string) (*HelmReleaseDetails, error) {
	deps := helm.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "HelmRelease", namespace, name, func() (*HelmReleaseDetails, error) {
		return helm.NewService(deps).ReleaseDetails(namespace, name)
	})
}

func (a *App) GetHelmManifest(namespace, name string) (string, error) {
	deps := helm.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "HelmManifest", namespace, name, func() (string, error) {
		return helm.NewService(deps).ReleaseManifest(namespace, name)
	})
}

func (a *App) GetHelmValues(namespace, name string) (map[string]interface{}, error) {
	deps := helm.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "HelmValues", namespace, name, func() (map[string]interface{}, error) {
		return helm.NewService(deps).ReleaseValues(namespace, name)
	})
}

func (a *App) DeleteHelmRelease(namespace, name string) error {
	_, err := FetchResource(a, "", "HelmDelete", namespace+"/"+name, func() (struct{}, error) {
		service := helm.NewService(helm.Dependencies{Common: a.resourceDependencies()})
		return struct{}{}, service.DeleteRelease(namespace, name)
	})
	return err
}
