package rbac

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	clientgotesting "k8s.io/client-go/testing"
)

func TestManagerClusterRolesIncludeBindings(t *testing.T) {
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name: "cluster-reader",
		},
		Rules: []rbacv1.PolicyRule{{
			Verbs:     []string{"get"},
			APIGroups: []string{""},
			Resources: []string{"pods"},
		}},
	}
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "crb-1"},
		RoleRef: rbacv1.RoleRef{
			Kind:     "ClusterRole",
			Name:     "cluster-reader",
			APIGroup: "rbac.authorization.k8s.io",
		},
	}

	client := fake.NewClientset(cr, crb)
	manager := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	details, err := manager.ClusterRole("cluster-reader")
	if err != nil {
		t.Fatalf("ClusterRole error: %v", err)
	}
	if len(details.Rules) != 1 || len(details.ClusterRoleBindings) != 0 {
		t.Fatalf("unexpected single fetch details: %#v", details)
	}

	all, err := manager.ClusterRoles()
	if err != nil {
		t.Fatalf("ClusterRoles error: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("expected one cluster role, got %d", len(all))
	}
	if len(all[0].ClusterRoleBindings) != 1 || all[0].ClusterRoleBindings[0] != "crb-1" {
		t.Fatalf("expected cluster role binding association, got %#v", all[0].ClusterRoleBindings)
	}
}

func TestManagerClusterRolesAggregatesBindingsAndSelectors(t *testing.T) {
	now := metav1.NewTime(time.Now().Add(-2 * time.Hour))
	clusterRole := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "aggregator",
			CreationTimestamp: now,
			Labels:            map[string]string{"app": "demo"},
		},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{""},
			Resources: []string{"pods"},
			Verbs:     []string{"list", "watch"},
		}},
		AggregationRule: &rbacv1.AggregationRule{
			ClusterRoleSelectors: []metav1.LabelSelector{{
				MatchLabels: map[string]string{"rbac.example.com/aggregate-to-aggregator": "true"},
			}},
		},
	}
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "aggregator-binding",
			CreationTimestamp: now,
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "aggregator",
		},
		Subjects: []rbacv1.Subject{{
			Kind:      "User",
			Name:      "alice",
			APIGroup:  "rbac.authorization.k8s.io",
			Namespace: "",
		}},
	}

	client := fake.NewClientset(clusterRole, crb)
	manager := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})

	roles, err := manager.ClusterRoles()
	if err != nil {
		t.Fatalf("ClusterRoles returned error: %v", err)
	}
	if len(roles) != 1 {
		t.Fatalf("expected a single cluster role, got %d", len(roles))
	}

	details := roles[0]
	if details.Name != "aggregator" {
		t.Fatalf("expected cluster role 'aggregator', got %q", details.Name)
	}
	if details.AggregationRule == nil || len(details.AggregationRule.ClusterRoleSelectors) != 1 {
		t.Fatalf("expected aggregation selectors to be captured, got %#v", details.AggregationRule)
	}
	if len(details.ClusterRoleBindings) != 1 || details.ClusterRoleBindings[0] != "aggregator-binding" {
		t.Fatalf("expected cluster role binding association, got %#v", details.ClusterRoleBindings)
	}
	if len(details.Rules) != 1 {
		t.Fatalf("expected rules to be preserved, got %#v", details.Rules)
	}
	if !strings.Contains(details.Details, "aggregated") {
		t.Fatalf("expected summary to mention aggregation, got %q", details.Details)
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
