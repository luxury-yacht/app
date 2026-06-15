package deployment_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/deployment"
)

func ptrInt32(v int32) *int32 { return &v }

func deploymentWithReplicas(desired, ready, updated, available int32) *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec:       appsv1.DeploymentSpec{Replicas: ptrInt32(desired)},
		Status: appsv1.DeploymentStatus{
			Replicas:          desired,
			ReadyReplicas:     ready,
			UpdatedReplicas:   updated,
			AvailableReplicas: available,
		},
	}
}

// TestBuildResourceModelStatus covers the Deployment status presentation that
// moved here with the model (was a case in resourcemodel's workload status test).
func TestBuildResourceModelStatus(t *testing.T) {
	tests := []struct {
		name             string
		deployment       *appsv1.Deployment
		wantState        string
		wantLabel        string
		wantPresentation string
		wantReason       string
	}{
		{
			name:             "running",
			deployment:       deploymentWithReplicas(3, 3, 3, 3),
			wantState:        "3/3",
			wantLabel:        "Running",
			wantPresentation: "ready",
		},
		{
			name:             "updating",
			deployment:       deploymentWithReplicas(3, 1, 2, 2),
			wantState:        "1/3",
			wantLabel:        "Updating",
			wantPresentation: "warning",
		},
		{
			name:             "scaled to zero",
			deployment:       deploymentWithReplicas(0, 0, 0, 0),
			wantState:        "0/0",
			wantLabel:        "Scaled to 0",
			wantPresentation: "inactive",
			wantReason:       "ScaledToZero",
		},
		{
			name: "paused",
			deployment: func() *appsv1.Deployment {
				d := deploymentWithReplicas(3, 1, 1, 1)
				d.Spec.Paused = true
				return d
			}(),
			wantState:        "true",
			wantLabel:        "Paused",
			wantPresentation: "warning",
			wantReason:       "SpecPaused",
		},
		{
			name: "progress deadline exceeded",
			deployment: func() *appsv1.Deployment {
				d := deploymentWithReplicas(3, 1, 1, 1)
				d.Status.Conditions = []appsv1.DeploymentCondition{{
					Type:    appsv1.DeploymentProgressing,
					Status:  corev1.ConditionFalse,
					Reason:  "ProgressDeadlineExceeded",
					Message: "ReplicaSet timed out",
				}}
				return d
			}(),
			wantState:        "False",
			wantLabel:        "Progress deadline",
			wantPresentation: "error",
			wantReason:       "ProgressDeadlineExceeded",
		},
		{
			name: "replica failure",
			deployment: func() *appsv1.Deployment {
				d := deploymentWithReplicas(3, 0, 0, 0)
				d.Status.Conditions = []appsv1.DeploymentCondition{{
					Type:   appsv1.DeploymentReplicaFailure,
					Status: corev1.ConditionTrue,
					Reason: "FailedCreate",
				}}
				return d
			}(),
			wantState:        "True",
			wantLabel:        "Replica failure",
			wantPresentation: "error",
			wantReason:       "FailedCreate",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := deployment.BuildResourceModel("cluster-a", tt.deployment)
			require.Equal(t, "cluster-a", model.Ref.ClusterID)
			require.Equal(t, "apps", model.Ref.Group)
			require.Equal(t, "v1", model.Ref.Version)
			require.Equal(t, "Deployment", model.Ref.Kind)
			require.Equal(t, "deployments", model.Ref.Resource)
			require.Equal(t, "default", model.Ref.Namespace)
			require.Equal(t, "web", model.Ref.Name)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
			require.Equal(t, tt.wantReason, model.Status.Reason)
		})
	}
}
