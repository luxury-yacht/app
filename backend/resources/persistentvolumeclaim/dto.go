/*
 * backend/resources/persistentvolumeclaim/dto.go
 *
 * PersistentVolumeClaim detail DTO (the frontend wire shape) + its sub-type.
 */

package persistentvolumeclaim

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type PersistentVolumeClaimDetails struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Age       string `json:"age"`
	Details   string `json:"details"`
	restypes.StatusProjection
	VolumeName   string               `json:"volumeName,omitempty"`
	StorageClass *string              `json:"storageClass,omitempty"`
	AccessModes  []string             `json:"accessModes"`
	Capacity     string               `json:"capacity"`
	VolumeMode   string               `json:"volumeMode"`
	Selector     map[string]string    `json:"selector,omitempty"`
	DataSource   *DataSourceInfo      `json:"dataSource,omitempty"`
	Conditions   []string             `json:"conditions,omitempty"`
	Labels       map[string]string    `json:"labels,omitempty"`
	Annotations  map[string]string    `json:"annotations,omitempty"`
	MountedBy    []restypes.ObjectRef `json:"mountedBy,omitempty"`
}

// DataSourceInfo represents the data source of a PVC.
type DataSourceInfo struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}
