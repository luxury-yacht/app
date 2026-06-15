package clusterrole

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const rbacAPIGroup = "rbac.authorization.k8s.io"

func TestBuildClusterRoleResourceModelFactsStatusAndReverseBindings(t *testing.T) {
	role := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: "view", UID: types.UID("cr-uid")},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{"apps"},
			Resources: []string{"deployments"},
			Verbs:     []string{"get"},
		}},
		AggregationRule: &rbacv1.AggregationRule{ClusterRoleSelectors: []metav1.LabelSelector{{
			MatchLabels: map[string]string{"rbac.example.com/aggregate-to-view": "true"},
		}}},
	}
	clusterRoleBindings := &rbacv1.ClusterRoleBindingList{Items: []rbacv1.ClusterRoleBinding{{
		ObjectMeta: metav1.ObjectMeta{Name: "view-all", UID: types.UID("crb-uid")},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "ClusterRole", Name: "view"},
	}}}
	roleBindings := &rbacv1.RoleBindingList{Items: []rbacv1.RoleBinding{{
		ObjectMeta: metav1.ObjectMeta{Name: "view-team", Namespace: "team-a", UID: types.UID("rb-uid")},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "ClusterRole", Name: "view"},
	}}}

	relationships := resourcemodel.NewResourceRelationshipIndex("cluster-a", resourcemodel.ResourceRelationshipIndexOptions{
		RoleBindings:        roleBindings,
		ClusterRoleBindings: clusterRoleBindings,
	})
	model := BuildResourceModel(
		"cluster-a",
		role,
		relationships,
		resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeReverseLinks},
	)
	require.Equal(t, "ClusterRole", model.Ref.Kind)
	require.Equal(t, "clusterroles", model.Ref.Resource)
	require.Equal(t, resourcemodel.ResourceScopeCluster, model.Scope)
	require.Equal(t, "Rules: 1 (aggregated)", model.Status.Label)

	facts := BuildFacts(role, relationships, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeReverseLinks})
	require.NotNil(t, facts.AggregationRule)
	require.Equal(t, "true", facts.AggregationRule.ClusterRoleSelectors[0]["rbac.example.com/aggregate-to-view"])
	require.Len(t, facts.ClusterRoleBindings, 1)
	require.Equal(t, "ClusterRoleBinding", facts.ClusterRoleBindings[0].Ref.Kind)
	require.Equal(t, "view-all", facts.ClusterRoleBindings[0].Ref.Name)
	require.Len(t, facts.RoleBindings, 1)
	require.Equal(t, "team-a", facts.RoleBindings[0].Ref.Namespace)
	require.Equal(t, "view-team", facts.RoleBindings[0].Ref.Name)
}
