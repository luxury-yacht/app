package persistentvolume_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
)

func persistentVolumeWithPhase(phase corev1.PersistentVolumePhase) *corev1.PersistentVolume {
	return &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{Name: "pv-data"},
		Spec: corev1.PersistentVolumeSpec{
			StorageClassName: "fast",
			Capacity:         corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("1Gi")},
			ClaimRef:         &corev1.ObjectReference{Namespace: "default", Name: "data"},
		},
		Status: corev1.PersistentVolumeStatus{Phase: phase},
	}
}

// TestBuildResourceModelStatus covers the PV status + facts that moved here with
// the model (was in resourcemodel's storage test).
func TestBuildResourceModelStatus(t *testing.T) {
	tests := []struct {
		name             string
		phase            corev1.PersistentVolumePhase
		reason           string
		wantState        string
		wantLabel        string
		wantPresentation string
		wantReason       string
	}{
		{name: "bound", phase: corev1.VolumeBound, wantState: "Bound", wantLabel: "Bound", wantPresentation: "ready"},
		{name: "available", phase: corev1.VolumeAvailable, wantState: "Available", wantLabel: "Available", wantPresentation: "ready"},
		{name: "pending", phase: corev1.VolumePending, wantState: "Pending", wantLabel: "Pending", wantPresentation: "warning"},
		{name: "released", phase: corev1.VolumeReleased, wantState: "Released", wantLabel: "Released", wantPresentation: "warning"},
		{name: "failed", phase: corev1.VolumeFailed, reason: "ReclaimFailed", wantState: "Failed", wantLabel: "Failed", wantPresentation: "error", wantReason: "ReclaimFailed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pv := persistentVolumeWithPhase(tt.phase)
			pv.Status.Reason = tt.reason
			model := persistentvolume.BuildResourceModel("cluster-a", pv)
			require.Equal(t, "cluster-a", model.Ref.ClusterID)
			require.Equal(t, "PersistentVolume", model.Ref.Kind)
			require.Equal(t, resourcemodel.ResourceScopeCluster, model.Scope)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
			require.Equal(t, tt.wantReason, model.Status.Reason)

			facts := persistentvolume.BuildFacts(pv)
			require.Equal(t, string(tt.phase), facts.Phase)
		})
	}
}

// TestBuildResourceModelTerminatingStatus covers deletion status precedence for PVs.
func TestBuildResourceModelTerminatingStatus(t *testing.T) {
	now := metav1.Now()
	pv := persistentVolumeWithPhase(corev1.VolumeReleased)
	pv.DeletionTimestamp = &now
	model := persistentvolume.BuildResourceModel("cluster-a", pv)
	require.Equal(t, "Terminating", model.Status.Label)
	require.Equal(t, "Released", model.Status.State)
	require.Equal(t, "terminating", model.Status.Presentation)
}
