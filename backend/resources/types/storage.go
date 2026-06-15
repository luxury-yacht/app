/*
 * backend/resources/types/storage.go
 *
 * Type definitions for Storage resources.
 * - Shared data structures for API responses.
 */

package types

// PersistentVolumeDetails represents comprehensive PV information.
// PersistentVolumeDetails + ClaimReference + VolumeSourceInfo moved to
// resources/persistentvolume (co-located with the PV model + detail builder).

// PersistentVolumeClaimDetails represents comprehensive PVC information.
// PersistentVolumeClaimDetails + DataSourceInfo moved to resources/persistentvolumeclaim
// (co-located with the PVC model + detail builder).

// StorageClassDetails represents comprehensive storage class information.
// StorageClassDetails + TopologySelector/TopologyLabelRequirement moved to
// resources/storageclass (co-located with the StorageClass model + detail builder).
