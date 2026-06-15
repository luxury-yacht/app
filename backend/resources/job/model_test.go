package job_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/job"
)

func ptrInt32(v int32) *int32 { return &v }

// TestBuildResourceModelStatus covers the Job status presentation that moved here
// with the model (was a case in resourcemodel's workload status test).
func TestBuildResourceModelStatus(t *testing.T) {
	suspend := true
	tests := []struct {
		name             string
		job              *batchv1.Job
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name: "completed",
			job: &batchv1.Job{
				ObjectMeta: metav1.ObjectMeta{Name: "batch-job", Namespace: "default"},
				Spec:       batchv1.JobSpec{Completions: ptrInt32(1)},
				Status: batchv1.JobStatus{
					Succeeded: 1,
					Conditions: []batchv1.JobCondition{{
						Type:   batchv1.JobComplete,
						Status: corev1.ConditionTrue,
					}},
				},
			},
			wantState:        "True",
			wantLabel:        "Completed",
			wantPresentation: "ready",
		},
		{
			name: "suspended",
			job: &batchv1.Job{
				ObjectMeta: metav1.ObjectMeta{Name: "batch-job", Namespace: "default"},
				Spec:       batchv1.JobSpec{Completions: ptrInt32(1), Suspend: &suspend},
			},
			wantState:        "true",
			wantLabel:        "Suspended",
			wantPresentation: "warning",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := job.BuildResourceModel("cluster-a", tt.job)
			require.Equal(t, "batch", model.Ref.Group)
			require.Equal(t, "v1", model.Ref.Version)
			require.Equal(t, "Job", model.Ref.Kind)
			require.Equal(t, "jobs", model.Ref.Resource)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
		})
	}
}
