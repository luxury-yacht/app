package networkpolicy

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this NetworkPolicy's selector edges to the pods it applies to.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	policy, ok := obj.(*networkingv1.NetworkPolicy)
	if !ok {
		return nil
	}
	return []objectmapspec.Edge{{Type: objectmapspec.EdgeSelector, TracedBy: "spec.podSelector", PodsLabelSelector: &policy.Spec.PodSelector}}
}
