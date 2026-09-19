package serviceaccount

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

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

	relationships := resourcemodel.NewResourceRelationshipIndex("cluster-a", resourcemodel.ResourceRelationshipIndexOptions{
		Pods:                pods,
		RoleBindings:        roleBindings,
		ClusterRoleBindings: clusterRoleBindings,
	})
	model := BuildResourceModel("cluster-a", sa)
	require.Equal(t, "ServiceAccount", model.Ref.Kind)
	require.Equal(t, "serviceaccounts", model.Ref.Resource)
	require.Equal(t, "Secrets: 1", model.Status.Label)

	facts := BuildFacts("cluster-a", sa, relationships, resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeReverseLinks})
	require.False(t, *facts.AutomountToken)
	require.Equal(t, "Secret", facts.Secrets[0].Ref.Kind)
	require.Equal(t, "default-token", facts.Secrets[0].Ref.Name)
	require.Equal(t, "pull-secret", facts.ImagePullSecrets[0].Ref.Name)
	require.Equal(t, []string{"explicit", "implicit"}, resourcemodel.ResourceLinkNames(facts.UsedByPods))
	require.Equal(t, []string{"rb"}, resourcemodel.ResourceLinkNames(facts.RoleBindings))
	require.Equal(t, []string{"crb"}, resourcemodel.ResourceLinkNames(facts.ClusterRoleBindings))
}

func TestServiceAccountMapAndListCountNamedTokenSecrets(t *testing.T) {
	sa := &corev1.ServiceAccount{
		ObjectMeta:       metav1.ObjectMeta{Name: "builder", Namespace: "team-a"},
		Secrets:          []corev1.ObjectReference{{}, {Name: "token-a"}, {Name: "token-b"}},
		ImagePullSecrets: []corev1.LocalObjectReference{{Name: "registry"}},
	}
	row := BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, sa)
	require.Equal(t, "Secrets: 2", row.Details)
	require.Equal(t, "cluster-a", row.Ref.ClusterID)
	status := ObjectMapStatus("cluster-a", *sa)
	require.Equal(t, "2", status.State)
	require.Equal(t, row.Details, status.Label)
	require.Equal(t, "ready", status.Presentation)
	deletion := metav1.Now()
	sa.DeletionTimestamp = &deletion
	status = ObjectMapStatus("cluster-a", *sa)
	require.Equal(t, "2", status.State)
	require.Equal(t, "terminating", status.Presentation)
	require.Equal(t, "DeletionTimestamp", status.Reason)
	require.Equal(t, row.Details, BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, sa).Details)
}
