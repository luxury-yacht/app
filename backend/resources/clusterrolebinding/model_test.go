package clusterrolebinding

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"

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

func TestClusterRoleBindingMapAndListCountUnknownSubjects(t *testing.T) {
	binding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "custom"},
		RoleRef:    rbacv1.RoleRef{APIGroup: "example.com", Kind: "Role"},
		Subjects:   []rbacv1.Subject{{Kind: "Unknown"}, {Kind: "User", Name: "alice"}},
	}
	row := BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, binding)
	require.Equal(t, "Role: -, Subjects: 2", row.Details)
	require.Equal(t, row.Details, ObjectMapStatus("cluster-a", *binding).Label)
	deletion := metav1.Now()
	binding.DeletionTimestamp = &deletion
	status := ObjectMapStatus("cluster-a", *binding)
	require.Equal(t, "2", status.State)
	require.Equal(t, "terminating", status.Presentation)
	require.Equal(t, row.Details, BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, binding).Details)
}
