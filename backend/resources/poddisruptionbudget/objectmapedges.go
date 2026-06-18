package poddisruptionbudget

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this PDB's selector edges to the pods it protects.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	pdb, ok := obj.(*policyv1.PodDisruptionBudget)
	if !ok || pdb.Spec.Selector == nil {
		return nil
	}
	return []objectmapspec.Edge{{Type: objectmapspec.EdgeSelector, PodsLabelSelector: pdb.Spec.Selector}}
}
