package pods

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this Pod's relationship edges (node, service account, and
// the config/secret/PVC objects its volumes and containers reference).
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	pod, ok := obj.(*corev1.Pod)
	if !ok {
		return nil
	}
	return objectmapspec.PodEdges(pod)
}
