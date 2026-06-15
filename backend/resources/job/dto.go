/*
 * backend/resources/job/dto.go
 *
 * Job detail DTO (the frontend wire shape), co-located with its model and detail
 * builder. Shared cross-kind field types live in resources/types.
 */

package job

import (
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type JobDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	restypes.StatusProjection
	Details string `json:"details"`
	Age     string `json:"age,omitempty"`

	// Job status
	Completions    int32        `json:"completions,omitempty"`
	Parallelism    int32        `json:"parallelism,omitempty"`
	Succeeded      int32        `json:"succeeded,omitempty"`
	Failed         int32        `json:"failed,omitempty"`
	Active         int32        `json:"active,omitempty"`
	StartTime      *metav1.Time `json:"startTime,omitempty"`
	CompletionTime *metav1.Time `json:"completionTime,omitempty"`
	Duration       string       `json:"duration,omitempty"`

	// Job configuration
	BackoffLimit            int32  `json:"backoffLimit,omitempty"`
	ActiveDeadlineSeconds   *int64 `json:"activeDeadlineSeconds,omitempty"`
	TTLSecondsAfterFinished *int32 `json:"ttlSecondsAfterFinished,omitempty"`
	CompletionMode          string `json:"completionMode,omitempty"`
	Suspend                 bool   `json:"suspend,omitempty"`

	// Selector and labels
	Selector    map[string]string `json:"selector,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Pod template information
	Containers []restypes.PodDetailInfoContainer `json:"containers,omitempty"`

	// Conditions
	Conditions []string `json:"conditions,omitempty"`

	// Related pods
	Pods              []restypes.PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *restypes.PodMetricsSummary `json:"podMetricsSummary,omitempty"`
}
