package cronjob

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/common"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapNode declares how this kind's owned reflector projects each object
// into an object-map graph node at intake.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*batchv1.CronJob))
	},
	ActionFacts: func(obj metav1.Object) *objectmap.ActionFacts {
		cron, ok := obj.(*batchv1.CronJob)
		if !ok {
			return nil
		}
		available := common.HasForwardableContainerPorts(cron.Spec.JobTemplate.Spec.Template.Spec.Containers)
		facts := &objectmap.ActionFacts{PortForwardAvailable: &available}
		if cron.Spec.Suspend != nil && *cron.Spec.Suspend {
			facts.Status = "Suspended"
		}
		return facts
	},
}
