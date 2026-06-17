package clusterrolebinding

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges returns this binding's edges: it grants a role and binds subjects.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	binding, ok := obj.(*rbacv1.ClusterRoleBinding)
	if !ok {
		return nil
	}
	facts := BuildFacts(clusterID, binding)
	edges := []objectmapspec.Edge{{Type: objectmapspec.EdgeGrants, Link: facts.RoleRef}}
	for _, subject := range facts.Subjects {
		if subject.Link == nil {
			continue
		}
		edges = append(edges, objectmapspec.Edge{Type: objectmapspec.EdgeBinds, Link: *subject.Link})
	}
	return edges
}
