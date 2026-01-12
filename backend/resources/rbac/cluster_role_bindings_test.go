package rbac

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	clientgotesting "k8s.io/client-go/testing"
	k8stesting "k8s.io/client-go/testing"
)

func TestManagerClusterRolesToleratesBindingListFailure(t *testing.T) {
	clusterRole := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name: "reader",
		},
	}

	client := fake.NewClientset(clusterRole)
	client.PrependReactor("list", "clusterrolebindings", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("nope")
	})

	manager := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           testsupport.NoopLogger{},
			KubernetesClient: client,
		},
	})

	roles, err := manager.ClusterRoles()
	if err != nil {
		t.Fatalf("expected ClusterRoles to succeed without cluster role bindings: %v", err)
	}
	if len(roles) != 1 {
		t.Fatalf("expected a single role, got %d", len(roles))
	}
	if len(roles[0].ClusterRoleBindings) != 0 {
		t.Fatalf("expected no cluster role bindings due to list failure, got %#v", roles[0].ClusterRoleBindings)
	}
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

	details := buildClusterRoleBindingDetails(crb)
	require.Equal(t, "ClusterRoleBinding", details.Kind)
	require.Equal(t, "crb", details.Name)
	require.Len(t, details.Subjects, 2)
	require.Contains(t, details.Details, "Role: admin")
}

func TestClusterRoleBindingsListError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "clusterrolebindings", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("crb-list")
	})

	manager := newManagerWithClient(client)
	if _, err := manager.ClusterRoleBindings(); err == nil {
		t.Fatalf("expected clusterrolebindings list error")
	}
}

func TestClusterRoleBindingGetError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "clusterrolebindings", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("crb-get")
	})

	manager := newManagerWithClient(client)
	if _, err := manager.ClusterRoleBinding("crb"); err == nil {
		t.Fatalf("expected clusterrolebinding get error")
	}
}
