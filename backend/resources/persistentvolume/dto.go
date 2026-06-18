/*
 * backend/resources/persistentvolume/dto.go
 *
 * PersistentVolume detail DTO (the frontend wire shape) + its sub-types.
 */

package persistentvolume

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type PersistentVolumeDetails struct {
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Age     string `json:"age"`
	Details string `json:"details"`
	restypes.StatusProjection
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
