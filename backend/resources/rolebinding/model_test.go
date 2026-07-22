package rolebinding

import (
	"testing"

	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const rbacAPIGroup = "rbac.authorization.k8s.io"

func TestBuildRoleBindingFactsAndSubjectLinks(t *testing.T) {
	binding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a", UID: types.UID("rb-uid")},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "Role", Name: "reader"},
		Subjects: []rbacv1.Subject{
			{Kind: "ServiceAccount", Name: "builder"},
			{Kind: "User", APIGroup: rbacv1.GroupName, Name: "jane@example.com"},
		},
	}

	facts := BuildFacts("cluster-a", binding)
	require.Equal(t, "Role", facts.RoleRef.Ref.Kind)
	require.Equal(t, "team-a", facts.RoleRef.Ref.Namespace)
	require.Equal(t, "reader", facts.RoleRef.Ref.Name)
	require.Len(t, facts.Subjects, 2)
	require.Equal(t, "ServiceAccount", facts.Subjects[0].Link.Ref.Kind)
	require.Equal(t, "team-a", facts.Subjects[0].Link.Ref.Namespace)
	require.Equal(t, "builder", facts.Subjects[0].Link.Ref.Name)
	require.Nil(t, facts.Subjects[1].Link.Ref)
	require.NotNil(t, facts.Subjects[1].Link.Display)
	require.Equal(t, "User", facts.Subjects[1].Link.Display.Kind)
	require.Equal(t, "jane@example.com", facts.Subjects[1].Link.Display.Name)
}

func TestBuildRoleBindingFactsKeepUnknownRoleRefDisplayOnly(t *testing.T) {
	binding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "custom", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{APIGroup: "example.com", Kind: "Role", Name: "reader"},
	}

	facts := BuildFacts("cluster-a", binding)
	require.Nil(t, facts.RoleRef.Ref)
	require.NotNil(t, facts.RoleRef.Display)
	require.Equal(t, "example.com", facts.RoleRef.Display.Group)
	require.Equal(t, "", facts.RoleRef.Display.Version)
	require.Equal(t, "Role", facts.RoleRef.Display.Kind)
	require.Equal(t, "reader", facts.RoleRef.Display.Name)
}

func TestDescribeSummary(t *testing.T) {
	binding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "Role", Name: "reader"},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder", Namespace: "team-a"}},
	}
	require.Equal(t, "Role: reader, Subjects: 1", DescribeSummary(BuildFacts("cluster-a", binding)))
}
