package poddisruptionbudget

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapNode declares how this kind's owned reflector projects each object
// into an object-map graph node at intake.
var ObjectMapNode = objectmapnode.Collector{
	Identity: Identity,
	Status: func(clusterID string, obj metav1.Object) *objectmap.Status {
		return ObjectMapStatus(clusterID, *obj.(*policyv1.PodDisruptionBudget))
	},
}
