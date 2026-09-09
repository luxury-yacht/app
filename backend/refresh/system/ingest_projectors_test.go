package system

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestIngestObjectMapProjectorNamespacedRBAC(t *testing.T) {
	for _, tc := range []struct {
		descriptor kindspec.Descriptor
		object     metav1.Object
		edges      int
	}{
		{role.Descriptor, &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "reader"}}, 0},
		{rolebinding.Descriptor, &rbacv1.RoleBinding{
			ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "readers"},
			RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: "reader"},
			Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder"}},
		}, 2},
	} {
		t.Run(tc.descriptor.Identity.Kind, func(t *testing.T) {
			project := ingestObjectMapProjector("cluster-b", tc.descriptor)
			require.NotNil(t, project)
			node := project(tc.object).(objectmapnode.Node)
			require.Equal(t, "team-a", node.Namespace)
			require.Equal(t, tc.object.GetName(), node.Name)
			require.NotNil(t, node.Status)
			require.Len(t, node.Edges, tc.edges)
			for _, edge := range node.Edges {
				require.NotNil(t, edge.Link.Ref)
				require.Equal(t, "cluster-b", edge.Link.Ref.ClusterID)
				require.Equal(t, "team-a", edge.Link.Ref.Namespace)
				require.Equal(t, "v1", edge.Link.Ref.Version)
			}
		})
	}
}
