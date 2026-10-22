package service

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/common"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapNode declares how this kind's owned reflector projects each object
// into an object-map graph node at intake.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*corev1.Service))
	},
	ActionFacts: func(obj metav1.Object) *objectmap.ActionFacts {
		svc, ok := obj.(*corev1.Service)
		if !ok {
			return nil
		}
		available := common.ServiceHasForwardablePorts(svc.Spec.Ports)
		return &objectmap.ActionFacts{PortForwardAvailable: &available}
	},
}
