/*
 * backend/resources/statefulset/dto.go
 *
 * StatefulSet detail DTO (the frontend wire shape), co-located with its model and
 * detail builder. Shared cross-kind field types live in resources/types.
 */

package statefulset

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type StatefulSetDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	restypes.StatusProjection
	Details         string `json:"details"`
	Replicas        string `json:"replicas"`
	Ready           string `json:"ready"`
	UpToDate        int32  `json:"upToDate,omitempty"`
	Available       int32  `json:"available"`
	DesiredReplicas int32  `json:"desiredReplicas"`
	Age             string `json:"age"`

	// Average resource utilization (per pod)
	restypes.ResourceUtilization

	// Update strategy
	UpdateStrategy       string `json:"updateStrategy,omitempty"`
	Partition            *int32 `json:"partition,omitempty"`
	MaxUnavailable       string `json:"maxUnavailable,omitempty"`
	PodManagementPolicy  string `json:"podManagementPolicy,omitempty"`
	MinReadySeconds      int32  `json:"minReadySeconds,omitempty"`
	RevisionHistoryLimit int32  `json:"revisionHistoryLimit,omitempty"`

	// Service information
	ServiceName                          string            `json:"serviceName,omitempty"`
	ServiceAccount                       string            `json:"serviceAccount,omitempty"`
	PersistentVolumeClaimRetentionPolicy map[string]string `json:"pvcRetentionPolicy,omitempty"`

	// Pod placement constraints (from the pod template).
	NodeSelector map[string]string `json:"nodeSelector,omitempty"`
	Tolerations  []string          `json:"tolerations,omitempty"`

	// Selector and labels
	Selector    map[string]string `json:"selector,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Template information
	Containers     []restypes.PodDetailInfoContainer `json:"containers,omitempty"`
	InitContainers []restypes.PodDetailInfoContainer `json:"initContainers,omitempty"`

	// Volume claim templates — structured summaries of each entry in
	// `spec.volumeClaimTemplates`.
	VolumeClaimTemplates []VolumeClaimTemplateSummary `json:"volumeClaimTemplates,omitempty"`

	// Pod information
	Pods              []restypes.PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *restypes.PodMetricsSummary `json:"podMetricsSummary,omitempty"`

	// Revision information
	CurrentRevision string `json:"currentRevision,omitempty"`
	UpdateRevision  string `json:"updateRevision,omitempty"`
	CurrentReplicas int32  `json:"currentReplicas,omitempty"`
	UpdatedReplicas int32  `json:"updatedReplicas,omitempty"`

	// Status
	ObservedGeneration int64  `json:"observedGeneration,omitempty"`
	CollisionCount     *int32 `json:"collisionCount,omitempty"`
}

// VolumeClaimTemplateSummary is a structured summary of a StatefulSet
// spec.volumeClaimTemplates entry.
type VolumeClaimTemplateSummary struct {
	Name           string   `json:"name"`
	StorageRequest string   `json:"storageRequest,omitempty"` // e.g. "10Gi"
	StorageClass   string   `json:"storageClass,omitempty"`   // empty = cluster default
	AccessModes    []string `json:"accessModes,omitempty"`    // e.g. ["ReadWriteOnce"]
	VolumeMode     string   `json:"volumeMode,omitempty"`     // "Filesystem" (default) or "Block"
}
