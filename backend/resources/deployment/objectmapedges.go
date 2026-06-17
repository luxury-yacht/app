package deployment

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this workload's relationship edges via its pod template.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	workload, ok := obj.(*appsv1.Deployment)
	if !ok {
		return nil
	}
	return objectmapspec.PodTemplateEdges(workload.Namespace, &workload.Spec.Template)
}
