/*
 * backend/resources/cronjob/dto.go
 *
 * CronJob detail DTO (the frontend wire shape), co-located with its model and
 * detail builder. Shared cross-kind field types (JobReference/JobSimpleInfo/
 * JobTemplateDetails) live in resources/types.
 */

package cronjob

import (
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type CronJobDetails struct {
	// Basic information
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	restypes.StatusProjection
	Details string `json:"details"`
	Age     string `json:"age"`

	// Schedule information
	Schedule              string       `json:"schedule"`
	Suspend               bool         `json:"suspend"`
	LastScheduleTime      *metav1.Time `json:"lastScheduleTime,omitempty"`
	LastSuccessfulTime    *metav1.Time `json:"lastSuccessfulTime,omitempty"`
	NextScheduleTime      string       `json:"nextScheduleTime,omitempty"`
	TimeUntilNextSchedule string       `json:"timeUntilNextSchedule,omitempty"`

	// Derived from owned Jobs — bounded by job-history retention. A
	// nil value can mean "never happened" OR "happened but the job
	// record has been garbage-collected"; the UI should hint at this.
	LastManualTime  *metav1.Time `json:"lastManualTime,omitempty"`
	LastFailureTime *metav1.Time `json:"lastFailureTime,omitempty"`

	// Job configuration
	ConcurrencyPolicy       string `json:"concurrencyPolicy"`
	StartingDeadlineSeconds *int64 `json:"startingDeadlineSeconds,omitempty"`
	SuccessfulJobsHistory   int32  `json:"successfulJobsHistory"`
	FailedJobsHistory       int32  `json:"failedJobsHistory"`

	// Active jobs
	ActiveJobs []restypes.JobReference `json:"activeJobs,omitempty"`

	// All owned jobs (completed, failed, running, etc.)
	Jobs []restypes.JobSimpleInfo `json:"jobs,omitempty"`

	// Job template information
	JobTemplate restypes.JobTemplateDetails `json:"jobTemplate"`

	// Labels and annotations
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	// Related pods
	Pods              []restypes.PodSimpleInfo    `json:"pods,omitempty"`
	PodMetricsSummary *restypes.PodMetricsSummary `json:"podMetricsSummary,omitempty"`
}
