package persistentvolumeclaim_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
)

func persistentVolumeClaimWithPhase(phase corev1.PersistentVolumeClaimPhase) *corev1.PersistentVolumeClaim {
	storageClass := "fast"
	return &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "default"},
		Spec: corev1.PersistentVolumeClaimSpec{
			StorageClassName: &storageClass,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("1Gi")},
			},
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase:    phase,
			Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("1Gi")},
		},
	}
}

// TestBuildResourceModelStatus covers the PVC status + facts that moved here with
// the model (was in resourcemodel's storage test).
func TestBuildResourceModelStatus(t *testing.T) {
	tests := []struct {
		name             string
		phase            corev1.PersistentVolumeClaimPhase
		wantState        string
		wantLabel        string
		wantPresentation string
	}{
		{name: "bound", phase: corev1.ClaimBound, wantState: "Bound", wantLabel: "Bound", wantPresentation: "ready"},
		{name: "pending", phase: corev1.ClaimPending, wantState: "Pending", wantLabel: "Pending", wantPresentation: "warning"},
		{name: "lost", phase: corev1.ClaimLost, wantState: "Lost", wantLabel: "Lost", wantPresentation: "error"},
		{name: "empty phase", phase: "", wantState: "Unknown", wantLabel: "Unknown", wantPresentation: "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pvc := persistentVolumeClaimWithPhase(tt.phase)
			model := persistentvolumeclaim.BuildResourceModel("cluster-a", pvc)
			require.Equal(t, "cluster-a", model.Ref.ClusterID)
			require.Equal(t, "", model.Ref.Group)
			require.Equal(t, "v1", model.Ref.Version)
			require.Equal(t, "PersistentVolumeClaim", model.Ref.Kind)
			require.Equal(t, "persistentvolumeclaims", model.Ref.Resource)
			require.Equal(t, "default", model.Ref.Namespace)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)

			facts := persistentvolumeclaim.BuildFacts(pvc, nil)
			require.Equal(t, string(tt.phase), facts.Phase)
		})
	}
}

func TestBuildResourceModelTerminatingStatus(t *testing.T) {
	now := metav1.Now()
	pvc := persistentVolumeClaimWithPhase(corev1.ClaimBound)
	pvc.DeletionTimestamp = &now
	pvc.Finalizers = []string{"kubernetes.io/pvc-protection"}
	model := persistentvolumeclaim.BuildResourceModel("cluster-a", pvc)
	require.Equal(t, "Terminating", model.Status.Label)
	require.Equal(t, "Bound", model.Status.State)
	require.Equal(t, "terminating", model.Status.Presentation)
	require.True(t, model.Status.Lifecycle.Deleting)
	require.True(t, model.Status.Lifecycle.FinalizerBlocked)
}
