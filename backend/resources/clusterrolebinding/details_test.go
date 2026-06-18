/*
 * backend/resources/clusterrolebinding/details_test.go
 *
 * Tests for the ClusterRoleBinding detail service (co-located with the kind).
 */

package clusterrolebinding

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
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

func TestBuildClusterRoleBindingDetails(t *testing.T) {
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "crb",
			CreationTimestamp: metav1.Now(),
			Labels:            map[string]string{"a": "b"},
			Annotations:       map[string]string{"note": "demo"},
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "admin",
		},
		Subjects: []rbacv1.Subject{
			{Kind: "User", Name: "alice", Namespace: "ns1"},
			{Kind: "ServiceAccount", Name: "sa", Namespace: "ns2"},
		},
	}

	manager := newService(fake.NewClientset(crb))
	details := manager.buildClusterRoleBindingDetails(crb)
	require.Equal(t, "ClusterRoleBinding", details.Kind)
	require.Equal(t, "crb", details.Name)
	require.Len(t, details.Subjects, 2)
	require.Contains(t, details.Details, "Role: admin")
}

func TestClusterRoleBindingsListError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "clusterrolebindings", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("crb-list")
	})

	manager := newService(client)
	if _, err := manager.ClusterRoleBindings(); err == nil {
		t.Fatalf("expected clusterrolebindings list error")
	}
}

func TestClusterRoleBindingGetError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "clusterrolebindings", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("crb-get")
	})

	manager := newService(client)
	if _, err := manager.ClusterRoleBinding("crb"); err == nil {
		t.Fatalf("expected clusterrolebinding get error")
	}
}
