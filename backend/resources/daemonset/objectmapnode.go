package daemonset

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/common"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapNode declares how this kind's owned reflector projects each object
// into an object-map graph node at intake.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*appsv1.DaemonSet))
	},
	ActionFacts: func(obj metav1.Object) *objectmap.ActionFacts {
		ds, ok := obj.(*appsv1.DaemonSet)
		if !ok {
			return nil
		}
		available := common.HasForwardableContainerPorts(ds.Spec.Template.Spec.Containers)
		return &objectmap.ActionFacts{PortForwardAvailable: &available}
	},
}
