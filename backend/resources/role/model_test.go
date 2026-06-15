package role

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const rbacAPIGroup = "rbac.authorization.k8s.io"

func TestBuildRoleResourceModelFactsStatusAndReverseBindings(t *testing.T) {
	r := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{Name: "reader", Namespace: "team-a", UID: types.UID("role-uid")},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{""},
			Resources: []string{"pods"},
			Verbs:     []string{"get", "list"},
		}},
	}
	bindings := &rbacv1.RoleBindingList{Items: []rbacv1.RoleBinding{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "reader-binding", Namespace: "team-a", UID: types.UID("rb-uid")},
			RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "Role", Name: "reader"},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "other-ns-binding", Namespace: "team-b"},
			RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "Role", Name: "reader"},
		},
	}}

	relationships := resourcemodel.NewResourceRelationshipIndex("cluster-a", resourcemodel.ResourceRelationshipIndexOptions{RoleBindings: bindings})
	model := BuildResourceModel(
		"cluster-a",
		r,
		relationships,
		resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks},
	)
	require.Equal(t, rbacAPIGroup, model.Ref.Group)
	require.Equal(t, "Role", model.Ref.Kind)
	require.Equal(t, "roles", model.Ref.Resource)
	require.Equal(t, resourcemodel.ResourceScopeNamespaced, model.Scope)
	require.Equal(t, "1", model.Status.State)
	require.Equal(t, "Rules: 1", model.Status.Label)

	facts := BuildFacts(r, relationships, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeReverseLinks})
	require.Equal(t, []string{"pods"}, facts.Rules[0].Resources)
	require.Len(t, facts.UsedByRoleBindings, 1)
	require.Equal(t, "cluster-a", facts.UsedByRoleBindings[0].Ref.ClusterID)
	require.Equal(t, "RoleBinding", facts.UsedByRoleBindings[0].Ref.Kind)
	require.Equal(t, "team-a", facts.UsedByRoleBindings[0].Ref.Namespace)
	require.Equal(t, "reader-binding", facts.UsedByRoleBindings[0].Ref.Name)
}

func TestBuildFactsSkipsReverseLinksWithoutMaterialization(t *testing.T) {
	r := &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Name: "reader", Namespace: "team-a"}}
	bindings := &rbacv1.RoleBindingList{Items: []rbacv1.RoleBinding{{
		ObjectMeta: metav1.ObjectMeta{Name: "reader-binding", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "Role", Name: "reader"},
	}}}
	relationships := resourcemodel.NewResourceRelationshipIndex("cluster-a", resourcemodel.ResourceRelationshipIndexOptions{RoleBindings: bindings})

	facts := BuildFacts(r, relationships, resourcemodel.ResourceModelBuildOptions{})
	require.Empty(t, facts.UsedByRoleBindings)
}
