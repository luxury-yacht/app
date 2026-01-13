/*
 * backend/resources_config.go
 *
 * App-level config resource wrappers.
 * - Exposes ConfigMap and Secret detail handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/config"

func (a *App) GetConfigMap(clusterID, namespace, name string) (*ConfigMapDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "ConfigMap", namespace, name, func() (*ConfigMapDetails, error) {
		return config.NewService(deps).ConfigMap(namespace, name)
	})
}

func (a *App) GetSecret(clusterID, namespace, name string) (*SecretDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "Secret", namespace, name, func() (*SecretDetails, error) {
		return config.NewService(deps).Secret(namespace, name)
	})
}
