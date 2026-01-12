/*
 * backend/resources_storage.go
 *
 * App-level storage resource wrappers.
 * - Exposes PV, PVC, and StorageClass handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/storage"

func (a *App) GetPersistentVolume(name string) (*PersistentVolumeDetails, error) {
	deps := a.resourceDependencies()
	return FetchClusterResource(a, "PersistentVolume", name, func() (*PersistentVolumeDetails, error) {
		return storage.NewService(deps).PersistentVolume(name)
	})
}

func (a *App) GetPersistentVolumeClaim(namespace, name string) (*PersistentVolumeClaimDetails, error) {
	deps := a.resourceDependencies()
	return FetchNamespacedResource(a, "PVC", namespace, name, func() (*PersistentVolumeClaimDetails, error) {
		return storage.NewService(deps).PersistentVolumeClaim(namespace, name)
	})
}

func (a *App) GetStorageClass(name string) (*StorageClassDetails, error) {
	deps := a.resourceDependencies()
	return FetchClusterResource(a, "StorageClass", name, func() (*StorageClassDetails, error) {
		return storage.NewService(deps).StorageClass(name)
	})
}
