package clusterrole

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this ClusterRole's aggregation edges to the cluster roles
// its aggregation rule selects.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	role, ok := obj.(*rbacv1.ClusterRole)
	if !ok || role.AggregationRule == nil {
		return nil
	}
	edges := make([]objectmapspec.Edge, 0, len(role.AggregationRule.ClusterRoleSelectors))
	for i := range role.AggregationRule.ClusterRoleSelectors {
		edges = append(edges, objectmapspec.Edge{Type: objectmapspec.EdgeAggregates, ClusterRoleSelector: &role.AggregationRule.ClusterRoleSelectors[i]})
	}
	return edges
}
