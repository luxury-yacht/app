package cronjob_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/cronjob"
)

// TestBuildResourceModelStatus covers the CronJob status presentation that moved
// here with the model (was a case in resourcemodel's workload status test).
func TestBuildResourceModelStatus(t *testing.T) {
	tests := []struct {
		name             string
		cronJob          *batchv1.CronJob
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name: "active",
			cronJob: &batchv1.CronJob{
				ObjectMeta: metav1.ObjectMeta{Name: "cron", Namespace: "default"},
				Status: batchv1.CronJobStatus{
					Active: []corev1.ObjectReference{{Name: "cron-1"}},
				},
			},
			wantState:        "1",
			wantLabel:        "Active",
			wantPresentation: "ready",
		},
		{
			name: "idle",
			cronJob: &batchv1.CronJob{
				ObjectMeta: metav1.ObjectMeta{Name: "cron", Namespace: "default"},
			},
			wantState:        "0",
			wantLabel:        "Idle",
			wantPresentation: "inactive",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := cronjob.BuildResourceModel("cluster-a", tt.cronJob)
			require.Equal(t, "batch", model.Ref.Group)
			require.Equal(t, "v1", model.Ref.Version)
			require.Equal(t, "CronJob", model.Ref.Kind)
			require.Equal(t, "cronjobs", model.Ref.Resource)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
		})
	}
}
