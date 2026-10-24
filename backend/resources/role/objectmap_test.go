package role

import (
	"testing"

	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestObjectMapNodeProjectsRBACStatus(t *testing.T) {
	obj := &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "reader"}, Rules: []rbacv1.PolicyRule{{Resources: []string{"pods"}, Verbs: []string{"get"}}}}
	status := ObjectMapNode.Status("cluster-a", obj)
	require.Equal(t, "Rules: 1", status.Label)
	require.Equal(t, "1", status.State)
	require.Equal(t, "ready", status.Presentation)
	deletion := metav1.Now()
	obj.DeletionTimestamp = &deletion
	status = ObjectMapNode.Status("cluster-a", obj)
	require.Equal(t, "terminating", status.Presentation)
}
