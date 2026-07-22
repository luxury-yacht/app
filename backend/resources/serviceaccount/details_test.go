/*
 * backend/resources/serviceaccount/details_test.go
 *
 * Tests for the ServiceAccount detail service (co-located with the kind).
 */

package serviceaccount

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

func newService(client kubernetes.Interface) *Service {
	return NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
		ClusterID:        "cluster-a",
	})
}

func requireRef(t *testing.T, refs []restypes.ObjectRef, index int, kind, namespace, name string) {
	t.Helper()
	require.Greater(t, len(refs), index)
	ref := refs[index]
	require.Equal(t, "cluster-a", ref.ClusterID)
	require.Equal(t, kind, ref.Kind)
	require.Equal(t, namespace, ref.Namespace)
	require.Equal(t, name, ref.Name)
}

func TestManagerServiceAccountAggregatesRelations(t *testing.T) {
	sa := &corev1.ServiceAccount{
		ObjectMeta:       metav1.ObjectMeta{Name: "builder", Namespace: "team-a"},
		Secrets:          []corev1.ObjectReference{{Name: "builder-token"}},
		ImagePullSecrets: []corev1.LocalObjectReference{{Name: "registry-creds"}},
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "builder-pod", Namespace: "team-a"},
		Spec:       corev1.PodSpec{ServiceAccountName: "builder"},
	}
	roleBinding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "builder-rb", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{APIGroup: "rbac.authorization.k8s.io", Kind: "Role", Name: "reader"},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder", Namespace: "team-a"}},
	}
	clusterRoleBinding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "builder-crb"},
		RoleRef:    rbacv1.RoleRef{APIGroup: "rbac.authorization.k8s.io", Kind: "ClusterRole", Name: "cluster-reader"},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder", Namespace: "team-a"}},
	}

	manager := newService(fake.NewClientset(sa, pod, roleBinding, clusterRoleBinding))
	details, err := manager.ServiceAccount("team-a", "builder")
	require.NoError(t, err)
	require.NotNil(t, details)
	require.Len(t, details.UsedByPods, 1)
	requireRef(t, details.UsedByPods, 0, "Pod", "team-a", "builder-pod")
	require.Len(t, details.RoleBindings, 1)
	requireRef(t, details.RoleBindings, 0, "RoleBinding", "team-a", "builder-rb")
	require.Len(t, details.ClusterRoleBindings, 1)
	requireRef(t, details.ClusterRoleBindings, 0, "ClusterRoleBinding", "", "builder-crb")
	require.Len(t, details.Secrets, 1)
	requireRef(t, details.Secrets, 0, "Secret", "team-a", "builder-token")
	require.Len(t, details.ImagePullSecrets, 1)
	requireRef(t, details.ImagePullSecrets, 0, "Secret", "team-a", "registry-creds")
	require.True(t, strings.Contains(details.Details, "Used by 1 pod"))
}

func TestServiceAccountGetError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "serviceaccounts", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("sa-get")
	})

	manager := newService(client)
	if _, err := manager.ServiceAccount("default", "sa"); err == nil {
		t.Fatalf("expected serviceaccount get error")
	}
}
