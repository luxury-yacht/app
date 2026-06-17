package cronjob

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this CronJob's relationship edges via its job's pod template.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	cron, ok := obj.(*batchv1.CronJob)
	if !ok {
		return nil
	}
	return objectmapspec.PodTemplateEdges(cron.Namespace, &cron.Spec.JobTemplate.Spec.Template)
}
