package cronjob

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	"github.com/luxury-yacht/app/backend/refresh/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/common"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
)

// ObjectMapNode declares how the object map collects this kind from the shared
// informer cache and projects each object into a graph node.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	List: func(factory informers.SharedInformerFactory) ([]metav1.Object, error) {
		items, err := factory.Batch().V1().CronJobs().Lister().List(labels.Everything())
		if err != nil {
			return nil, err
		}
		return objectmapnode.Objects(items), nil
	},
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
