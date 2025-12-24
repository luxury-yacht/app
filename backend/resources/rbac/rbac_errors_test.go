package rbac

import (
	"context"
	"errors"
	"testing"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	clientgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
)

type stubLogger struct{}

func (stubLogger) Debug(string, ...string) {}
func (stubLogger) Info(string, ...string)  {}
func (stubLogger) Warn(string, ...string)  {}
func (stubLogger) Error(string, ...string) {}

func newManagerWithClient(client *fake.Clientset) *Service {
	return NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           stubLogger{},
			KubernetesClient: client,
		},
	})
}

func TestRolesListError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "roles", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom-roles")
	})

	manager := newManagerWithClient(client)
	if _, err := manager.Roles("ns"); err == nil {
		t.Fatalf("expected roles list error")
	}
}

func TestRoleBindingGetError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "rolebindings", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("nope")
	})

	manager := newManagerWithClient(client)
	if _, err := manager.RoleBinding("ns", "rb"); err == nil {
		t.Fatalf("expected rolebinding get error")
	}
}

func TestClusterRolesWarnOnBindingListFailure(t *testing.T) {
	role := &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "reader"}}
	client := fake.NewClientset(role)
	client.PrependReactor("list", "clusterrolebindings", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("crb-fail")
	})

	manager := newManagerWithClient(client)
	roles, err := manager.ClusterRoles()
	if err != nil {
		t.Fatalf("expected cluster roles list to succeed, got %v", err)
	}
	if len(roles) != 1 {
		t.Fatalf("expected cluster role to be returned even when CRB list fails")
	}
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

func TestServiceAccountsListError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "serviceaccounts", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("sa-list")
	})

	manager := newManagerWithClient(client)
	if _, err := manager.ServiceAccounts("default"); err == nil {
		t.Fatalf("expected serviceaccounts list error")
	}
}

func TestServiceAccountGetError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "serviceaccounts", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("sa-get")
	})

	manager := newManagerWithClient(client)
	if _, err := manager.ServiceAccount("default", "sa"); err == nil {
		t.Fatalf("expected serviceaccount get error")
	}
}

func TestRoleWarnsWhenBindingsListFails(t *testing.T) {
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{Name: "reader", Namespace: "ns"},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{""},
			Resources: []string{"pods"},
			Verbs:     []string{"get"},
		}},
	}
	client := fake.NewClientset(role)
	client.PrependReactor("list", "rolebindings", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("rb-fail")
	})

	manager := newManagerWithClient(client)
	details, err := manager.Role("ns", "reader")
	if err != nil {
		t.Fatalf("expected role to still return details, got error %v", err)
	}
	if len(details.UsedByRoleBindings) != 0 {
		t.Fatalf("expected empty rolebindings when list failed")
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

func TestRoleBindingsListError(t *testing.T) {
	client := fake.NewClientset(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ns"}})
	client.PrependReactor("list", "rolebindings", func(clientgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("rb-list")
	})

	manager := newManagerWithClient(client)
	if _, err := manager.RoleBindings("ns"); err == nil {
		t.Fatalf("expected rolebindings list error")
	}
}
