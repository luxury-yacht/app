package rbac

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	clientgotesting "k8s.io/client-go/testing"
	k8stesting "k8s.io/client-go/testing"
)

func TestManagerRoleIncludesBindings(t *testing.T) {
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "reader",
			Namespace: "team-a",
			CreationTimestamp: metav1.Time{
				Time: time.Now().Add(-time.Hour),
			},
			Labels: map[string]string{"app": "demo"},
		},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{"apps"},
			Resources: []string{"deployments"},
			Verbs:     []string{"get", "list"},
		}},
	}
	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "reader-binding",
			Namespace: "team-a",
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     "reader",
		},
	}

	client := fake.NewClientset(role, rb)
	manager := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
			KubernetesClient: client,
		},
	})

	details, err := manager.Role("team-a", "reader")
	if err != nil {
		t.Fatalf("Role returned error: %v", err)
	}
	if details == nil {
		t.Fatalf("expected role details")
	}
	if len(details.Rules) != 1 {
		t.Fatalf("expected a single policy rule, got %d", len(details.Rules))
	}
	if len(details.UsedByRoleBindings) != 1 || details.UsedByRoleBindings[0] != "reader-binding" {
		t.Fatalf("expected role binding association, got %#v", details.UsedByRoleBindings)
	}
	if details.Details == "" || details.Kind != "Role" {
		t.Fatalf("expected summary string and kind Role, got details=%q kind=%q", details.Details, details.Kind)
	}
}

func TestManagerRoleSkipsBindingsOnListFailure(t *testing.T) {
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "orphan",
			Namespace: "team-a",
		},
	}

	client := fake.NewClientset(role)
	client.PrependReactor("list", "rolebindings", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	manager := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
			KubernetesClient: client,
		},
	})

	details, err := manager.Role("team-a", "orphan")
	if err != nil {
		t.Fatalf("expected Role to succeed even when role binding list fails: %v", err)
	}
	if len(details.UsedByRoleBindings) != 0 {
		t.Fatalf("expected no role bindings due to list failure, got %#v", details.UsedByRoleBindings)
	}
	if !strings.Contains(details.Details, "Rules") {
		t.Fatalf("expected summary to mention rules, got %q", details.Details)
	}
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
