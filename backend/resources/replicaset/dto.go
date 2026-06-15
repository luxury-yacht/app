/*
 * backend/resources/replicaset/dto.go
 *
 * ReplicaSet detail DTO (the frontend wire shape), co-located with its model and
 * detail builder. Shared cross-kind field types live in resources/types.
 */

package replicaset

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type ReplicaSetDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	restypes.StatusProjection
	Details         string `json:"details"`
	Replicas        string `json:"replicas"`
	Ready           string `json:"ready"`
	Available       int32  `json:"available"`
	DesiredReplicas int32  `json:"desiredReplicas"`
	Age             string `json:"age"`

	// Average resource utilization (per pod)
	restypes.ResourceUtilization

	// ReplicaSet configuration
	MinReadySeconds int32             `json:"minReadySeconds,omitempty"`
	Selector        map[string]string `json:"selector,omitempty"`
	Labels          map[string]string `json:"labels,omitempty"`
	Annotations     map[string]string `json:"annotations,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Template information
	Containers     []restypes.PodDetailInfoContainer `json:"containers,omitempty"`
	InitContainers []restypes.PodDetailInfoContainer `json:"initContainers,omitempty"`

	// Pod information
	Pods              []restypes.PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *restypes.PodMetricsSummary `json:"podMetricsSummary,omitempty"`

	// Status
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
	IsActive           bool  `json:"isActive"`
}
