package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildDeploymentResourceModelStatus(t *testing.T) {
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
				deployment := deploymentWithReplicas(3, 1, 1, 1)
				deployment.Spec.Paused = true
				return deployment
			}(),
			wantState:        "true",
			wantLabel:        "Paused",
			wantPresentation: "warning",
			wantReason:       "SpecPaused",
		},
		{
			name: "progress deadline exceeded",
			deployment: func() *appsv1.Deployment {
				deployment := deploymentWithReplicas(3, 1, 1, 1)
				deployment.Status.Conditions = []appsv1.DeploymentCondition{{
					Type:    appsv1.DeploymentProgressing,
					Status:  corev1.ConditionFalse,
					Reason:  "ProgressDeadlineExceeded",
					Message: "ReplicaSet timed out",
				}}
				return deployment
			}(),
			wantState:        "False",
			wantLabel:        "Progress deadline",
			wantPresentation: "error",
			wantReason:       "ProgressDeadlineExceeded",
		},
		{
			name: "replica failure",
			deployment: func() *appsv1.Deployment {
				deployment := deploymentWithReplicas(3, 0, 0, 0)
				deployment.Status.Conditions = []appsv1.DeploymentCondition{{
					Type:   appsv1.DeploymentReplicaFailure,
					Status: corev1.ConditionTrue,
					Reason: "FailedCreate",
				}}
				return deployment
			}(),
			wantState:        "True",
			wantLabel:        "Replica failure",
			wantPresentation: "error",
			wantReason:       "FailedCreate",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := BuildDeploymentResourceModel("cluster-a", tt.deployment)
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

func TestBuildWorkloadResourceModelStatusForSupportedKinds(t *testing.T) {
	suspend := true
	tests := []struct {
		name             string
		model            ResourceModel
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{
			name:             "daemonset running",
			model:            BuildDaemonSetResourceModel("cluster-a", daemonSetWithReplicas(3, 3, 3, 3)),
			wantState:        "3/3",
			wantLabel:        "Running",
			wantPresentation: "ready",
		},
		{
			name:             "replicaset updating",
			model:            BuildReplicaSetResourceModel("cluster-a", replicaSetWithReplicas(3, 0, 0)),
			wantState:        "0/3",
			wantLabel:        "Updating",
			wantPresentation: "warning",
		},
		{
			name: "job completed",
			model: BuildJobResourceModel("cluster-a", &batchv1.Job{
				ObjectMeta: workloadMeta("batch-job"),
				Spec:       batchv1.JobSpec{Completions: ptrInt32(1)},
				Status: batchv1.JobStatus{
					Succeeded: 1,
					Conditions: []batchv1.JobCondition{{
						Type:   batchv1.JobComplete,
						Status: corev1.ConditionTrue,
					}},
				},
			}),
			wantState:        "True",
			wantLabel:        "Completed",
			wantPresentation: "ready",
		},
		{
			name: "job suspended",
			model: BuildJobResourceModel("cluster-a", &batchv1.Job{
				ObjectMeta: workloadMeta("batch-job"),
				Spec:       batchv1.JobSpec{Completions: ptrInt32(1), Suspend: &suspend},
			}),
			wantState:        "true",
			wantLabel:        "Suspended",
			wantPresentation: "warning",
		},
		{
			name: "cronjob active",
			model: BuildCronJobResourceModel("cluster-a", &batchv1.CronJob{
				ObjectMeta: workloadMeta("cron"),
				Status: batchv1.CronJobStatus{
					Active: []corev1.ObjectReference{{Name: "cron-1"}},
				},
			}),
			wantState:        "1",
			wantLabel:        "Active",
			wantPresentation: "ready",
		},
		{
			name: "cronjob idle",
			model: BuildCronJobResourceModel("cluster-a", &batchv1.CronJob{
				ObjectMeta: workloadMeta("cron"),
			}),
			wantState:        "0",
			wantLabel:        "Idle",
			wantPresentation: "inactive",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.wantState, tt.model.Status.State)
			require.Equal(t, tt.wantLabel, tt.model.Status.Label)
			require.Equal(t, tt.wantPresentation, tt.model.Status.Presentation)
		})
	}
}

func deploymentWithReplicas(desired, ready, updated, available int32) *appsv1.Deployment {
	deployment := &appsv1.Deployment{
		ObjectMeta: workloadMeta("web"),
		Spec: appsv1.DeploymentSpec{
			Replicas: ptrInt32(desired),
		},
		Status: appsv1.DeploymentStatus{
			Replicas:          desired,
			ReadyReplicas:     ready,
			UpdatedReplicas:   updated,
			AvailableReplicas: available,
		},
	}
	return deployment
}

func daemonSetWithReplicas(desired, current, ready, available int32) *appsv1.DaemonSet {
	return &appsv1.DaemonSet{
		ObjectMeta: workloadMeta("daemon"),
		Status: appsv1.DaemonSetStatus{
			DesiredNumberScheduled: desired,
			CurrentNumberScheduled: current,
			NumberReady:            ready,
			NumberAvailable:        available,
			UpdatedNumberScheduled: current,
		},
	}
}

func replicaSetWithReplicas(desired, ready, available int32) *appsv1.ReplicaSet {
	return &appsv1.ReplicaSet{
		ObjectMeta: workloadMeta("replica"),
		Spec:       appsv1.ReplicaSetSpec{Replicas: ptrInt32(desired)},
		Status: appsv1.ReplicaSetStatus{
			Replicas:          desired,
			ReadyReplicas:     ready,
			AvailableReplicas: available,
		},
	}
}

func workloadMeta(name string) metav1.ObjectMeta {
	return metav1.ObjectMeta{Name: name, Namespace: "default"}
}

func ptrInt32(value int32) *int32 {
	return &value
}
