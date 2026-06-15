/*
 * backend/resources/job/facts.go
 *
 * Canonical Job facts — the single typed extraction of a Job's intrinsic fields.
 * Shared workload primitives are embedded from resourcemodel.
 */

package job

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Facts is the canonical Job model facts.
type Facts struct {
	resourcemodel.PodTemplateFacts
	DesiredReplicas         int32                          `json:"desiredReplicas"`
	Active                  int32                          `json:"active,omitempty"`
	Succeeded               int32                          `json:"succeeded,omitempty"`
	Failed                  int32                          `json:"failed,omitempty"`
	Suspended               bool                           `json:"suspended,omitempty"`
	Parallelism             int32                          `json:"parallelism,omitempty"`
	BackoffLimit            int32                          `json:"backoffLimit,omitempty"`
	ActiveDeadlineSeconds   *int64                         `json:"activeDeadlineSeconds,omitempty"`
	TTLSecondsAfterFinished *int32                         `json:"ttlSecondsAfterFinished,omitempty"`
	CompletionMode          string                         `json:"completionMode,omitempty"`
	StartTime               *metav1.Time                   `json:"startTime,omitempty"`
	CompletionTime          *metav1.Time                   `json:"completionTime,omitempty"`
	Selector                map[string]string              `json:"selector,omitempty"`
	Conditions              []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
}
