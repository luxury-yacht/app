/*
 * backend/resources/types/storage.go
 *
 * Type definitions for Storage resources.
 * - Shared data structures for API responses.
 */

package types

// PersistentVolumeDetails represents comprehensive PV information.
type PersistentVolumeDetails struct {
	Kind          string            `json:"kind"`
	Name          string            `json:"name"`
	Age           string            `json:"age"`
	Details       string            `json:"details"`
	Status        string            `json:"status"`
	StorageClass  string            `json:"storageClass"`
	Capacity      string            `json:"capacity"`
	AccessModes   []string          `json:"accessModes"`
	VolumeMode    string            `json:"volumeMode"`
	ReclaimPolicy string            `json:"reclaimPolicy"`
	ClaimRef      *ClaimReference   `json:"claimRef,omitempty"`
	MountOptions  []string          `json:"mountOptions,omitempty"`
	VolumeSource  VolumeSourceInfo  `json:"volumeSource"`
	NodeAffinity  []string          `json:"nodeAffinity,omitempty"`
	Labels        map[string]string `json:"labels,omitempty"`
	Annotations   map[string]string `json:"annotations,omitempty"`
	Conditions    []string          `json:"conditions,omitempty"`
}

// ClaimReference represents a reference to a PVC.
type ClaimReference struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// VolumeSourceInfo captures the backing volume configuration for a PV.
type VolumeSourceInfo struct {
	Type    string            `json:"type"`
	Details map[string]string `json:"details,omitempty"`
}

// PersistentVolumeClaimDetails represents comprehensive PVC information.
type PersistentVolumeClaimDetails struct {
	Kind         string            `json:"kind"`
	Name         string            `json:"name"`
	Namespace    string            `json:"namespace"`
	Age          string            `json:"age"`
	Details      string            `json:"details"`
	Status       string            `json:"status"`
	VolumeName   string            `json:"volumeName,omitempty"`
	StorageClass *string           `json:"storageClass,omitempty"`
	AccessModes  []string          `json:"accessModes"`
	Capacity     string            `json:"capacity"`
	VolumeMode   string            `json:"volumeMode"`
	Selector     map[string]string `json:"selector,omitempty"`
	DataSource   *DataSourceInfo   `json:"dataSource,omitempty"`
	Conditions   []string          `json:"conditions,omitempty"`
	Labels       map[string]string `json:"labels,omitempty"`
	Annotations  map[string]string `json:"annotations,omitempty"`
	MountedBy    []string          `json:"mountedBy,omitempty"`
}

// DataSourceInfo represents the data source of a PVC.
type DataSourceInfo struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// StorageClassDetails represents comprehensive storage class information.
type StorageClassDetails struct {
	Kind                 string             `json:"kind"`
	Name                 string             `json:"name"`
	Age                  string             `json:"age"`
	Details              string             `json:"details"`
	IsDefault            bool               `json:"isDefault"`
	Provisioner          string             `json:"provisioner"`
	ReclaimPolicy        string             `json:"reclaimPolicy"`
	VolumeBindingMode    string             `json:"volumeBindingMode"`
	AllowVolumeExpansion bool               `json:"allowVolumeExpansion"`
	Parameters           map[string]string  `json:"parameters,omitempty"`
	MountOptions         []string           `json:"mountOptions,omitempty"`
	AllowedTopologies    []TopologySelector `json:"allowedTopologies,omitempty"`
	Labels               map[string]string  `json:"labels,omitempty"`
	Annotations          map[string]string  `json:"annotations,omitempty"`
	PersistentVolumes    []string           `json:"persistentVolumes,omitempty"`
}

// TopologySelector represents topology requirements.
type TopologySelector struct {
	MatchLabelExpressions []TopologyLabelRequirement `json:"matchLabelExpressions"`
}

// TopologyLabelRequirement represents a topology label requirement.
type TopologyLabelRequirement struct {
	Key    string   `json:"key"`
	Values []string `json:"values"`
}
