package clusterrolebinding

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const rbacAPIGroup = "rbac.authorization.k8s.io"

func TestBuildClusterRoleBindingResourceModelFactsAndLinks(t *testing.T) {
	binding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "admins", UID: types.UID("crb-uid")},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "ClusterRole", Name: "admin"},
		Subjects: []rbacv1.Subject{{
			Kind:      "ServiceAccount",
			Name:      "builder",
			Namespace: "team-a",
		}},
	}

	model := BuildResourceModel("cluster-a", binding)
	require.Equal(t, "ClusterRoleBinding", model.Ref.Kind)
	require.Equal(t, resourcemodel.ResourceScopeCluster, model.Scope)

	facts := BuildFacts("cluster-a", binding)
	require.Equal(t, "ClusterRole", facts.RoleRef.Ref.Kind)
	require.Equal(t, "admin", facts.RoleRef.Ref.Name)
	require.Equal(t, "ServiceAccount", facts.Subjects[0].Link.Ref.Kind)
	require.Equal(t, "team-a", facts.Subjects[0].Link.Ref.Namespace)
	require.Equal(t, "builder", facts.Subjects[0].Link.Ref.Name)
}

func TestDescribeSummary(t *testing.T) {
	binding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "admins"},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "ClusterRole", Name: "admin"},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder", Namespace: "team-a"}},
	}
	require.Equal(t, "Role: admin, Subjects: 1", DescribeSummary(BuildFacts("cluster-a", binding)))
}
