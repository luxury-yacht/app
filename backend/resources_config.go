package backend

import "github.com/luxury-yacht/app/backend/resources/config"

func (a *App) GetConfigMap(namespace, name string) (*ConfigMapDetails, error) {
	deps := config.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "ConfigMap", namespace, name, func() (*ConfigMapDetails, error) {
		return config.NewService(deps).ConfigMap(namespace, name)
	})
}

func (a *App) GetSecret(namespace, name string) (*SecretDetails, error) {
	deps := config.Dependencies{Common: a.resourceDependencies()}
	return FetchNamespacedResource(a, "Secret", namespace, name, func() (*SecretDetails, error) {
		return config.NewService(deps).Secret(namespace, name)
	})
}
