/*
 * backend/resources/clusterrole/details_test.go
 *
 * Tests for the ClusterRole detail service (co-located with the kind).
 */

package clusterrole

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
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

func requireRef(t *testing.T, refs []restypes.ObjectRef, index int, kind, namespace, name string) {
	t.Helper()
	require.Greater(t, len(refs), index)
	ref := refs[index]
	require.Equal(t, "cluster-a", ref.ClusterID)
	require.Equal(t, kind, ref.Kind)
	require.Equal(t, namespace, ref.Namespace)
	require.Equal(t, name, ref.Name)
}

func TestManagerClusterRolesIncludeBindings(t *testing.T) {
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: "cluster-reader"},
		Rules: []rbacv1.PolicyRule{{
			Verbs:     []string{"get"},
			APIGroups: []string{""},
			Resources: []string{"pods"},
		}},
	}
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "crb-1"},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "cluster-reader", APIGroup: "rbac.authorization.k8s.io"},
	}
	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "rb-1", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{Kind: "ClusterRole", Name: "cluster-reader", APIGroup: "rbac.authorization.k8s.io"},
	}

	manager := newService(fake.NewClientset(cr, crb, rb))

	details, err := manager.ClusterRole("cluster-reader")
	require.NoError(t, err)
	require.Len(t, details.Rules, 1)
	require.Len(t, details.ClusterRoleBindings, 1)
	requireRef(t, details.ClusterRoleBindings, 0, "ClusterRoleBinding", "", "crb-1")
	require.Len(t, details.RoleBindings, 1)
	requireRef(t, details.RoleBindings, 0, "RoleBinding", "team-a", "rb-1")

	all, err := manager.ClusterRoles()
	require.NoError(t, err)
	require.Len(t, all, 1)
	require.Len(t, all[0].ClusterRoleBindings, 1)
	requireRef(t, all[0].ClusterRoleBindings, 0, "ClusterRoleBinding", "", "crb-1")
	require.Len(t, all[0].RoleBindings, 1)
	requireRef(t, all[0].RoleBindings, 0, "RoleBinding", "team-a", "rb-1")
}

func TestManagerClusterRolesAggregatesBindingsAndSelectors(t *testing.T) {
	now := metav1.NewTime(time.Now().Add(-2 * time.Hour))
	clusterRole := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{Name: "aggregator", CreationTimestamp: now, Labels: map[string]string{"app": "demo"}},
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
		ObjectMeta: metav1.ObjectMeta{Name: "aggregator-binding", CreationTimestamp: now},
		RoleRef:    rbacv1.RoleRef{APIGroup: "rbac.authorization.k8s.io", Kind: "ClusterRole", Name: "aggregator"},
		Subjects:   []rbacv1.Subject{{Kind: "User", Name: "alice", APIGroup: "rbac.authorization.k8s.io"}},
	}

	manager := newService(fake.NewClientset(clusterRole, crb))
	roles, err := manager.ClusterRoles()
	require.NoError(t, err)
	require.Len(t, roles, 1)

	details := roles[0]
	require.Equal(t, "aggregator", details.Name)
	require.NotNil(t, details.AggregationRule)
	require.Len(t, details.AggregationRule.ClusterRoleSelectors, 1)
	require.Len(t, details.ClusterRoleBindings, 1)
	requireRef(t, details.ClusterRoleBindings, 0, "ClusterRoleBinding", "", "aggregator-binding")
	require.Len(t, details.Rules, 1)
	require.True(t, strings.Contains(details.Details, "aggregated"))
}

func TestClusterRolesWarnOnBindingListFailure(t *testing.T) {
	role := &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "reader"}}
	client := fake.NewClientset(role)
	client.PrependReactor("list", "clusterrolebindings", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("crb-fail")
	})

	manager := newService(client)
	roles, err := manager.ClusterRoles()
	require.NoError(t, err)
	require.Len(t, roles, 1)
}

func TestManagerClusterRolesToleratesBindingListFailure(t *testing.T) {
	clusterRole := &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "reader"}}
	client := fake.NewClientset(clusterRole)
	client.PrependReactor("list", "clusterrolebindings", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("nope")
	})

	manager := newService(client)
	roles, err := manager.ClusterRoles()
	require.NoError(t, err)
	require.Len(t, roles, 1)
	require.Empty(t, roles[0].ClusterRoleBindings)
}
