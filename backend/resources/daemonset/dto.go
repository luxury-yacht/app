/*
 * backend/resources/daemonset/dto.go
 *
 * DaemonSet detail DTO (the frontend wire shape), co-located with its model and
 * detail builder. Shared cross-kind field types live in resources/types.
 */

package daemonset

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type DaemonSetDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	restypes.StatusProjection
	Details   string `json:"details"`
	Desired   int32  `json:"desired"`
	Current   int32  `json:"current"`
	Ready     int32  `json:"ready"`
	UpToDate  int32  `json:"upToDate,omitempty"`
	Available int32  `json:"available"`
	Updated   int32  `json:"updated,omitempty"`
	Age       string `json:"age"`

	// Average resource utilization (per pod)
	restypes.ResourceUtilization

	// Update strategy
	UpdateStrategy       string `json:"updateStrategy,omitempty"`
	MaxUnavailable       string `json:"maxUnavailable,omitempty"`
	MaxSurge             string `json:"maxSurge,omitempty"`
	MinReadySeconds      int32  `json:"minReadySeconds,omitempty"`
	RevisionHistoryLimit int32  `json:"revisionHistoryLimit,omitempty"`

	// Service information
	ServiceAccount string `json:"serviceAccount,omitempty"`

	// Selector and labels
	Selector    map[string]string `json:"selector,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Pod placement constraints (from the pod template).
	NodeSelector map[string]string `json:"nodeSelector,omitempty"`
	Tolerations  []string          `json:"tolerations,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Template information
	Containers     []restypes.PodDetailInfoContainer `json:"containers,omitempty"`
	InitContainers []restypes.PodDetailInfoContainer `json:"initContainers,omitempty"`

	// Pod information
	Pods              []restypes.PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *restypes.PodMetricsSummary `json:"podMetricsSummary,omitempty"`

	// Status
	ObservedGeneration int64  `json:"observedGeneration,omitempty"`
	NumberMisscheduled int32  `json:"numberMisscheduled,omitempty"`
	CollisionCount     *int32 `json:"collisionCount,omitempty"`
}
