/*
 * backend/resources_storage.go
 *
 * App-level storage resource wrappers.
 * - Exposes PV, PVC, and StorageClass handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/storage"

func (a *App) GetPersistentVolume(clusterID, name string) (*PersistentVolumeDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "PersistentVolume", name, func() (*PersistentVolumeDetails, error) {
		return storage.NewService(deps).PersistentVolume(name)
	})
}

func (a *App) GetPersistentVolumeClaim(clusterID, namespace, name string) (*PersistentVolumeClaimDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, "PVC", namespace, name, func() (*PersistentVolumeClaimDetails, error) {
		return storage.NewService(deps).PersistentVolumeClaim(namespace, name)
	})
}

func (a *App) GetStorageClass(clusterID, name string) (*StorageClassDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "StorageClass", name, func() (*StorageClassDetails, error) {
		return storage.NewService(deps).StorageClass(name)
	})
}
