package objectmapspec

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
)

func TestRBACBindingEdgesPreserveCanonicalLinks(t *testing.T) {
	role := resourcemodel.RBACRoleRefLink("cluster-a", "team-a", rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: "reader"})
	subjects := resourcemodel.RBACSubjectFactsList("cluster-a", "team-a", []rbacv1.Subject{
		{Kind: "ServiceAccount", Namespace: "team-b", Name: "builder"},
		{Kind: "ServiceAccount"},
	})
	edges := RBACBindingEdges(role, subjects)
	require.Len(t, edges, 2)
	require.Equal(t, EdgeGrants, edges[0].Type)
	require.Equal(t, role, edges[0].Link)
	require.Equal(t, EdgeBinds, edges[1].Type)
	require.Equal(t, "cluster-a", edges[1].Link.Ref.ClusterID)
	require.Equal(t, "team-b", edges[1].Link.Ref.Namespace)
}
