package persistentvolume

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this PersistentVolume's edge to its StorageClass.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	pv, ok := obj.(*corev1.PersistentVolume)
	if !ok || pv.Spec.StorageClassName == "" {
		return nil
	}
	return []objectmapspec.Edge{{Type: objectmapspec.EdgeStorageClass, CoreRef: &objectmapspec.CoreRef{Group: "storage.k8s.io", Version: "v1", Kind: "StorageClass", Name: pv.Spec.StorageClassName}}}
}
