/*
 * backend/resources/deployment/dto.go
 *
 * Deployment detail DTO (the frontend wire shape), co-located with its model and
 * detail builder. Shared cross-kind field types live in resources/types.
 */

package deployment

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type DeploymentDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	restypes.StatusProjection
	Details         string `json:"details"`
	Replicas        string `json:"replicas"`
	Ready           string `json:"ready"`
	Updated         string `json:"updated,omitempty"`
	UpToDate        int32  `json:"upToDate,omitempty"`
	Available       int32  `json:"available"`
	DesiredReplicas int32  `json:"desiredReplicas"`
	Age             string `json:"age"`

	// Average resource utilization (per pod)
	restypes.ResourceUtilization

	// Strategy information
	Strategy         string `json:"strategy,omitempty"`
	MaxSurge         string `json:"maxSurge,omitempty"`
	MaxUnavailable   string `json:"maxUnavailable,omitempty"`
	MinReadySeconds  int32  `json:"minReadySeconds,omitempty"`
	RevisionHistory  int32  `json:"revisionHistory,omitempty"`
	ProgressDeadline int32  `json:"progressDeadline,omitempty"`

	// Service information
	ServiceAccount string `json:"serviceAccount,omitempty"`

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

	// Pod information
	Pods              []restypes.PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *restypes.PodMetricsSummary `json:"podMetricsSummary,omitempty"`

	// ReplicaSet information
	CurrentRevision     string                       `json:"currentRevision,omitempty"`
	CurrentReplicaSet   string                       `json:"currentReplicaSet,omitempty"`
	ReplicaSets         []string                     `json:"replicaSets,omitempty"`
	ReplicaSetSummaries []restypes.ReplicaSetSummary `json:"replicaSetSummaries,omitempty"`

	// Rollout status
	ObservedGeneration int64  `json:"observedGeneration,omitempty"`
	Paused             bool   `json:"paused,omitempty"`
	RolloutStatus      string `json:"rolloutStatus,omitempty"`
	RolloutMessage     string `json:"rolloutMessage,omitempty"`
}
