package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildPersistentVolumeClaimResourceModelStatus(t *testing.T) {
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
			model := BuildPersistentVolumeClaimResourceModel("cluster-a", pvc)
			require.Equal(t, "cluster-a", model.Ref.ClusterID)
			require.Equal(t, "", model.Ref.Group)
			require.Equal(t, "v1", model.Ref.Version)
			require.Equal(t, "PersistentVolumeClaim", model.Ref.Kind)
			require.Equal(t, "persistentvolumeclaims", model.Ref.Resource)
			require.Equal(t, "default", model.Ref.Namespace)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
			require.Equal(t, string(tt.phase), model.Facts.PersistentVolumeClaim.Phase)
		})
	}
}

func TestBuildPersistentVolumeResourceModelStatus(t *testing.T) {
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
			model := BuildPersistentVolumeResourceModel("cluster-a", pv)
			require.Equal(t, "cluster-a", model.Ref.ClusterID)
			require.Equal(t, "PersistentVolume", model.Ref.Kind)
			require.Equal(t, ResourceScopeCluster, model.Scope)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
			require.Equal(t, tt.wantReason, model.Status.Reason)
			require.Equal(t, string(tt.phase), model.Facts.PersistentVolume.Phase)
		})
	}
}

func TestBuildStorageClassResourceModelStatus(t *testing.T) {
	tests := []struct {
		name             string
		annotations      map[string]string
		wantState        string
		wantLabel        string
		wantPresentation string
		wantDefault      bool
		wantReason       string
	}{
		{
			name:             "default class",
			annotations:      map[string]string{"storageclass.kubernetes.io/is-default-class": "true"},
			wantState:        "true",
			wantLabel:        "Default",
			wantPresentation: "ready",
			wantDefault:      true,
			wantReason:       "storageclass.kubernetes.io/is-default-class",
		},
		{
			name:             "non-default class",
			annotations:      map[string]string{"storageclass.kubernetes.io/is-default-class": "false"},
			wantState:        "false",
			wantLabel:        "Available",
			wantPresentation: "ready",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			storageClass := &storagev1.StorageClass{
				ObjectMeta:  metav1.ObjectMeta{Name: "fast", Annotations: tt.annotations},
				Provisioner: "example.com/provisioner",
			}
			model := BuildStorageClassResourceModel("cluster-a", storageClass)
			require.Equal(t, "storage.k8s.io", model.Ref.Group)
			require.Equal(t, "StorageClass", model.Ref.Kind)
			require.Equal(t, ResourceScopeCluster, model.Scope)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
			require.Equal(t, tt.wantReason, model.Status.Reason)
			require.Equal(t, tt.wantDefault, model.Facts.StorageClass.DefaultClass)
			if tt.wantReason != "" {
				require.Equal(t, "true", model.Facts.StorageClass.DefaultClassAnnotationValue)
				require.Equal(t, "true", model.Status.Signals[0].Status)
			}
		})
	}
}

func TestBuildStorageResourceModelTerminatingStatusPreservesSourceState(t *testing.T) {
	now := metav1.Now()
	pvc := persistentVolumeClaimWithPhase(corev1.ClaimBound)
	pvc.DeletionTimestamp = &now
	pvc.Finalizers = []string{"kubernetes.io/pvc-protection"}
	pvcModel := BuildPersistentVolumeClaimResourceModel("cluster-a", pvc)
	require.Equal(t, "Terminating", pvcModel.Status.Label)
	require.Equal(t, "Bound", pvcModel.Status.State)
	require.Equal(t, "terminating", pvcModel.Status.Presentation)
	require.True(t, pvcModel.Status.Lifecycle.Deleting)
	require.True(t, pvcModel.Status.Lifecycle.FinalizerBlocked)

	pv := persistentVolumeWithPhase(corev1.VolumeReleased)
	pv.DeletionTimestamp = &now
	pvModel := BuildPersistentVolumeResourceModel("cluster-a", pv)
	require.Equal(t, "Terminating", pvModel.Status.Label)
	require.Equal(t, "Released", pvModel.Status.State)
	require.Equal(t, "terminating", pvModel.Status.Presentation)

	storageClass := &storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "fast",
			Annotations:       map[string]string{"storageclass.kubernetes.io/is-default-class": "true"},
			DeletionTimestamp: &now,
		},
		Provisioner: "example.com/provisioner",
	}
	storageClassModel := BuildStorageClassResourceModel("cluster-a", storageClass)
	require.Equal(t, "Terminating", storageClassModel.Status.Label)
	require.Equal(t, "true", storageClassModel.Status.State)
	require.Equal(t, "terminating", storageClassModel.Status.Presentation)
	require.Equal(t, "storageclass.kubernetes.io/is-default-class", storageClassModel.Facts.StorageClass.DefaultClassAnnotation)
	require.Equal(t, "true", storageClassModel.Facts.StorageClass.DefaultClassAnnotationValue)
}

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
