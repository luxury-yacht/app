package rolebinding

import (
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ObjectMapEdges links the binding to its role and subjects using canonical facts.
func ObjectMapEdges(clusterID string, obj metav1.Object) []objectmapspec.Edge {
	binding, ok := obj.(*rbacv1.RoleBinding)
	if !ok {
		return nil
	}
	facts := BuildFacts(clusterID, binding)
	return objectmapspec.RBACBindingEdges(facts.RoleRef, facts.Subjects)
}
