package persistentvolumeclaim

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this PVC's edge to its bound PersistentVolume, or (when
// not yet bound) to its StorageClass.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	pvc, ok := obj.(*corev1.PersistentVolumeClaim)
	if !ok {
		return nil
	}
	if pvc.Spec.VolumeName != "" {
		return []objectmapspec.Edge{{Type: objectmapspec.EdgeVolumeBinding, CoreRef: &objectmapspec.CoreRef{Version: "v1", Kind: "PersistentVolume", Name: pvc.Spec.VolumeName}}}
	}
	if pvc.Spec.StorageClassName != nil && *pvc.Spec.StorageClassName != "" {
		return []objectmapspec.Edge{{Type: objectmapspec.EdgeStorageClass, CoreRef: &objectmapspec.CoreRef{Group: "storage.k8s.io", Version: "v1", Kind: "StorageClass", Name: *pvc.Spec.StorageClassName}}}
	}
	return nil
}
