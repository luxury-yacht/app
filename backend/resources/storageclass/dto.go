/*
 * backend/resources/storageclass/dto.go
 *
 * StorageClass detail DTO (the frontend wire shape) + its kind-specific topology
 * sub-types, co-located with the model and detail builder.
 */

package storageclass

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type StorageClassDetails struct {
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Age     string `json:"age"`
	Details string `json:"details"`
	restypes.StatusProjection
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
