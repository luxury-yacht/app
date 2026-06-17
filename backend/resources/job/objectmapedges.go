package job

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this Job's relationship edges via its pod template.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	job, ok := obj.(*batchv1.Job)
	if !ok {
		return nil
	}
	return objectmapspec.PodTemplateEdges(job.Namespace, &job.Spec.Template)
}
