/*
 * backend/resources/cronjob/facts.go
 *
 * Canonical CronJob facts — the single typed extraction of a CronJob's intrinsic
 * scheduling fields.
 */

package cronjob

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// Facts is the canonical CronJob model facts.
type Facts struct {
	Suspended               bool         `json:"suspended,omitempty"`
	ActiveJobs              int32        `json:"activeJobs,omitempty"`
	Schedule                string       `json:"schedule,omitempty"`
	ConcurrencyPolicy       string       `json:"concurrencyPolicy,omitempty"`
	StartingDeadlineSeconds *int64       `json:"startingDeadlineSeconds,omitempty"`
	SuccessfulJobsHistory   int32        `json:"successfulJobsHistory,omitempty"`
	FailedJobsHistory       int32        `json:"failedJobsHistory,omitempty"`
	LastScheduleTime        *metav1.Time `json:"lastScheduleTime,omitempty"`
	LastSuccessfulTime      *metav1.Time `json:"lastSuccessfulTime,omitempty"`
}
