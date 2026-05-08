package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestBuildRoleResourceModelFactsStatusAndReverseBindings(t *testing.T) {
	role := &rbacv1.Role{
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

	model := BuildRoleResourceModel("cluster-a", role, bindings)
	require.Equal(t, "cluster-a", model.Ref.ClusterID)
	require.Equal(t, rbacAPIGroup, model.Ref.Group)
	require.Equal(t, "v1", model.Ref.Version)
	require.Equal(t, "Role", model.Ref.Kind)
	require.Equal(t, "roles", model.Ref.Resource)
	require.Equal(t, "team-a", model.Ref.Namespace)
	require.Equal(t, ResourceScopeNamespaced, model.Scope)
	require.Equal(t, "1", model.Status.State)
	require.Equal(t, "Rules: 1", model.Status.Label)
	require.Equal(t, "ready", model.Status.Presentation)
	require.Equal(t, []string{"pods"}, model.Facts.Role.Rules[0].Resources)
	require.Len(t, model.Facts.Role.UsedByRoleBindings, 1)
	require.Equal(t, "cluster-a", model.Facts.Role.UsedByRoleBindings[0].Ref.ClusterID)
	require.Equal(t, "RoleBinding", model.Facts.Role.UsedByRoleBindings[0].Ref.Kind)
	require.Equal(t, "team-a", model.Facts.Role.UsedByRoleBindings[0].Ref.Namespace)
	require.Equal(t, "reader-binding", model.Facts.Role.UsedByRoleBindings[0].Ref.Name)
}

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

	model := BuildClusterRoleResourceModel("cluster-a", role, clusterRoleBindings, roleBindings)
	require.Equal(t, "ClusterRole", model.Ref.Kind)
	require.Equal(t, "clusterroles", model.Ref.Resource)
	require.Equal(t, ResourceScopeCluster, model.Scope)
	require.Equal(t, "Rules: 1 (aggregated)", model.Status.Label)
	require.NotNil(t, model.Facts.ClusterRole.AggregationRule)
	require.Equal(t, "true", model.Facts.ClusterRole.AggregationRule.ClusterRoleSelectors[0]["rbac.example.com/aggregate-to-view"])
	require.Len(t, model.Facts.ClusterRole.ClusterRoleBindings, 1)
	require.Equal(t, "ClusterRoleBinding", model.Facts.ClusterRole.ClusterRoleBindings[0].Ref.Kind)
	require.Equal(t, "view-all", model.Facts.ClusterRole.ClusterRoleBindings[0].Ref.Name)
	require.Len(t, model.Facts.ClusterRole.RoleBindings, 1)
	require.Equal(t, "team-a", model.Facts.ClusterRole.RoleBindings[0].Ref.Namespace)
	require.Equal(t, "view-team", model.Facts.ClusterRole.RoleBindings[0].Ref.Name)
}

func TestBuildRoleBindingResourceModelFactsAndSubjectLinks(t *testing.T) {
	binding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "readers", Namespace: "team-a", UID: types.UID("rb-uid")},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "Role", Name: "reader"},
		Subjects: []rbacv1.Subject{
			{Kind: "ServiceAccount", Name: "builder"},
			{Kind: "User", APIGroup: rbacv1.GroupName, Name: "jane@example.com"},
		},
	}

	model := BuildRoleBindingResourceModel("cluster-a", binding)
	require.Equal(t, "RoleBinding", model.Ref.Kind)
	require.Equal(t, "Role: reader, Subjects: 2", model.Status.Label)
	require.Equal(t, "Role", model.Facts.RoleBinding.RoleRef.Ref.Kind)
	require.Equal(t, "team-a", model.Facts.RoleBinding.RoleRef.Ref.Namespace)
	require.Equal(t, "reader", model.Facts.RoleBinding.RoleRef.Ref.Name)
	require.Len(t, model.Facts.RoleBinding.Subjects, 2)
	require.Equal(t, "ServiceAccount", model.Facts.RoleBinding.Subjects[0].Link.Ref.Kind)
	require.Equal(t, "team-a", model.Facts.RoleBinding.Subjects[0].Link.Ref.Namespace)
	require.Equal(t, "builder", model.Facts.RoleBinding.Subjects[0].Link.Ref.Name)
	require.Nil(t, model.Facts.RoleBinding.Subjects[1].Link.Ref)
	require.NotNil(t, model.Facts.RoleBinding.Subjects[1].Link.Display)
	require.Equal(t, "User", model.Facts.RoleBinding.Subjects[1].Link.Display.Kind)
	require.Equal(t, "jane@example.com", model.Facts.RoleBinding.Subjects[1].Link.Display.Name)
}

func TestBuildRoleBindingResourceModelKeepsUnknownRoleRefDisplayOnly(t *testing.T) {
	binding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "custom", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{APIGroup: "example.com", Kind: "Role", Name: "reader"},
	}

	model := BuildRoleBindingResourceModel("cluster-a", binding)
	require.Nil(t, model.Facts.RoleBinding.RoleRef.Ref)
	require.NotNil(t, model.Facts.RoleBinding.RoleRef.Display)
	require.Equal(t, "example.com", model.Facts.RoleBinding.RoleRef.Display.Group)
	require.Equal(t, "", model.Facts.RoleBinding.RoleRef.Display.Version)
	require.Equal(t, "Role", model.Facts.RoleBinding.RoleRef.Display.Kind)
	require.Equal(t, "reader", model.Facts.RoleBinding.RoleRef.Display.Name)
}

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

	model := BuildClusterRoleBindingResourceModel("cluster-a", binding)
	require.Equal(t, "ClusterRoleBinding", model.Ref.Kind)
	require.Equal(t, ResourceScopeCluster, model.Scope)
	require.Equal(t, "ClusterRole", model.Facts.ClusterRoleBinding.RoleRef.Ref.Kind)
	require.Equal(t, "admin", model.Facts.ClusterRoleBinding.RoleRef.Ref.Name)
	require.Equal(t, "ServiceAccount", model.Facts.ClusterRoleBinding.Subjects[0].Link.Ref.Kind)
	require.Equal(t, "team-a", model.Facts.ClusterRoleBinding.Subjects[0].Link.Ref.Namespace)
	require.Equal(t, "builder", model.Facts.ClusterRoleBinding.Subjects[0].Link.Ref.Name)
}

func TestBuildServiceAccountResourceModelFactsStatusAndReverseUsage(t *testing.T) {
	automount := false
	sa := &corev1.ServiceAccount{
		ObjectMeta:                   metav1.ObjectMeta{Name: "default", Namespace: "team-a", UID: types.UID("sa-uid")},
		Secrets:                      []corev1.ObjectReference{{Name: "default-token"}},
		ImagePullSecrets:             []corev1.LocalObjectReference{{Name: "pull-secret"}},
		AutomountServiceAccountToken: &automount,
	}
	pods := &corev1.PodList{Items: []corev1.Pod{
		{ObjectMeta: metav1.ObjectMeta{Name: "implicit", Namespace: "team-a", UID: types.UID("pod-implicit")}},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "explicit", Namespace: "team-a", UID: types.UID("pod-explicit")},
			Spec:       corev1.PodSpec{ServiceAccountName: "default"},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "other", Namespace: "team-b"},
			Spec:       corev1.PodSpec{ServiceAccountName: "default"},
		},
	}}
	roleBindings := &rbacv1.RoleBindingList{Items: []rbacv1.RoleBinding{{
		ObjectMeta: metav1.ObjectMeta{Name: "rb", Namespace: "team-a", UID: types.UID("rb-uid")},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "default"}},
	}}}
	clusterRoleBindings := &rbacv1.ClusterRoleBindingList{Items: []rbacv1.ClusterRoleBinding{{
		ObjectMeta: metav1.ObjectMeta{Name: "crb", UID: types.UID("crb-uid")},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "default", Namespace: "team-a"}},
	}}}

	model := BuildServiceAccountResourceModel("cluster-a", sa, pods, roleBindings, clusterRoleBindings)
	require.Equal(t, "ServiceAccount", model.Ref.Kind)
	require.Equal(t, "serviceaccounts", model.Ref.Resource)
	require.Equal(t, "Secrets: 1", model.Status.Label)
	require.False(t, *model.Facts.ServiceAccount.AutomountToken)
	require.Equal(t, "Secret", model.Facts.ServiceAccount.Secrets[0].Ref.Kind)
	require.Equal(t, "default-token", model.Facts.ServiceAccount.Secrets[0].Ref.Name)
	require.Equal(t, "pull-secret", model.Facts.ServiceAccount.ImagePullSecrets[0].Ref.Name)
	require.Equal(t, []string{"explicit", "implicit"}, ResourceLinkNames(model.Facts.ServiceAccount.UsedByPods))
	require.Equal(t, []string{"rb"}, ResourceLinkNames(model.Facts.ServiceAccount.RoleBindings))
	require.Equal(t, []string{"crb"}, ResourceLinkNames(model.Facts.ServiceAccount.ClusterRoleBindings))
}
