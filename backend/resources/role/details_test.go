/*
 * backend/resources/role/details_test.go
 *
 * Tests for the Role detail service (co-located with the kind).
 */

package role

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

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

func TestManagerRoleIncludesBindings(t *testing.T) {
	r := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "reader",
			Namespace:         "team-a",
			CreationTimestamp: metav1.Time{Time: time.Now().Add(-time.Hour)},
			Labels:            map[string]string{"app": "demo"},
		},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{"apps"},
			Resources: []string{"deployments"},
			Verbs:     []string{"get", "list"},
		}},
	}
	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "reader-binding", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{APIGroup: "rbac.authorization.k8s.io", Kind: "Role", Name: "reader"},
	}

	manager := newService(fake.NewClientset(r, rb))
	details, err := manager.Role("team-a", "reader")
	require.NoError(t, err)
	require.NotNil(t, details)
	require.Len(t, details.Rules, 1)
	require.Len(t, details.UsedByRoleBindings, 1)
	ref := details.UsedByRoleBindings[0]
	require.Equal(t, "cluster-a", ref.ClusterID)
	require.Equal(t, "RoleBinding", ref.Kind)
	require.Equal(t, "team-a", ref.Namespace)
	require.Equal(t, "reader-binding", ref.Name)
	require.NotEmpty(t, details.Details)
	require.Equal(t, "Role", details.Kind)
}

func TestManagerRoleSkipsBindingsOnListFailure(t *testing.T) {
	r := &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Name: "orphan", Namespace: "team-a"}}
	client := fake.NewClientset(r)
	client.PrependReactor("list", "rolebindings", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	manager := newService(client)
	details, err := manager.Role("team-a", "orphan")
	require.NoError(t, err)
	require.Empty(t, details.UsedByRoleBindings)
	require.True(t, strings.Contains(details.Details, "Rules"))
}

func TestRoleWarnsWhenBindingsListFails(t *testing.T) {
	r := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{Name: "reader", Namespace: "ns"},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{""},
			Resources: []string{"pods"},
			Verbs:     []string{"get"},
		}},
	}
	client := fake.NewClientset(r)
	client.PrependReactor("list", "rolebindings", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("rb-fail")
	})

	manager := newService(client)
	details, err := manager.Role("ns", "reader")
	require.NoError(t, err)
	require.Empty(t, details.UsedByRoleBindings)
}
