package rbac

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
)

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

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

func TestManagerServiceAccountAggregatesRelations(t *testing.T) {
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "builder",
			Namespace: "team-a",
		},
		Secrets: []corev1.ObjectReference{{Name: "builder-token"}},
		ImagePullSecrets: []corev1.LocalObjectReference{
			{Name: "registry-creds"},
		},
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "builder-pod",
			Namespace: "team-a",
		},
		Spec: corev1.PodSpec{ServiceAccountName: "builder"},
	}
	roleBinding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "builder-rb",
			Namespace: "team-a",
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     "reader",
		},
		Subjects: []rbacv1.Subject{{
			Kind:      "ServiceAccount",
			Name:      "builder",
			Namespace: "team-a",
		}},
	}
	clusterRoleBinding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: "builder-crb",
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "cluster-reader",
		},
		Subjects: []rbacv1.Subject{{
			Kind:      "ServiceAccount",
			Name:      "builder",
			Namespace: "team-a",
		}},
	}

	client := fake.NewClientset(sa, pod, roleBinding, clusterRoleBinding)
	manager := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
			KubernetesClient: client,
		},
	})

	details, err := manager.ServiceAccount("team-a", "builder")
	if err != nil {
		t.Fatalf("ServiceAccount returned error: %v", err)
	}
	if details == nil {
		t.Fatalf("expected service account details")
	}
	if len(details.UsedByPods) != 1 || details.UsedByPods[0] != "builder-pod" {
		t.Fatalf("expected UsedByPods to include builder-pod, got %#v", details.UsedByPods)
	}
	if len(details.RoleBindings) != 1 || details.RoleBindings[0] != "builder-rb" {
		t.Fatalf("expected RoleBindings to include builder-rb, got %#v", details.RoleBindings)
	}
	if len(details.ClusterRoleBindings) != 1 || details.ClusterRoleBindings[0] != "builder-crb" {
		t.Fatalf("expected ClusterRoleBindings to include builder-crb, got %#v", details.ClusterRoleBindings)
	}
	if len(details.Secrets) != 1 || details.Secrets[0] != "builder-token" {
		t.Fatalf("expected Secrets to contain builder-token, got %#v", details.Secrets)
	}
	if len(details.ImagePullSecrets) != 1 || details.ImagePullSecrets[0] != "registry-creds" {
		t.Fatalf("expected ImagePullSecrets to contain registry-creds, got %#v", details.ImagePullSecrets)
	}
	if !strings.Contains(details.Details, "Used by 1 pod") {
		t.Fatalf("expected summary to mention pod usage, got %q", details.Details)
	}
}

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
	manager := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
			KubernetesClient: client,
		},
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

func TestManagerRoleBindingsList(t *testing.T) {
	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "rb-1",
			Namespace: "team-a",
			Labels:    map[string]string{"env": "test"},
		},
		Subjects: []rbacv1.Subject{{
			Kind:      "ServiceAccount",
			Name:      "sa1",
			Namespace: "team-a",
		}},
		RoleRef: rbacv1.RoleRef{Kind: "Role", Name: "reader"},
	}
	client := fake.NewClientset(rb)
	manager := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
			KubernetesClient: client,
		},
	})

	list, err := manager.RoleBindings("team-a")
	if err != nil {
		t.Fatalf("RoleBindings error: %v", err)
	}
	if len(list) != 1 || list[0].Name != "rb-1" || len(list[0].Subjects) != 1 {
		t.Fatalf("unexpected role bindings %+v", list)
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
	manager := NewService(Dependencies{
		Common: common.Dependencies{
			Context:          context.Background(),
			Logger:           noopLogger{},
			KubernetesClient: client,
		},
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
			Logger:           noopLogger{},
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
