/*
 * backend/resources/rolebinding/details_test.go
 *
 * Tests for the RoleBinding detail service (co-located with the kind).
 */

package rolebinding

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
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

func TestServiceRoleBindingsList(t *testing.T) {
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
	manager := newService(fake.NewClientset(rb))

	list, err := manager.RoleBindings("team-a")
	if err != nil {
		t.Fatalf("RoleBindings error: %v", err)
	}
	if len(list) != 1 || list[0].Name != "rb-1" || len(list[0].Subjects) != 1 {
		t.Fatalf("unexpected role bindings %+v", list)
	}
}

func TestRoleBindingGetError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "rolebindings", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("nope")
	})

	manager := newService(client)
	if _, err := manager.RoleBinding("ns", "rb"); err == nil {
		t.Fatalf("expected rolebinding get error")
	}
}

func TestRoleBindingsListError(t *testing.T) {
	client := fake.NewClientset(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ns"}})
	client.PrependReactor("list", "rolebindings", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("rb-list")
	})

	manager := newService(client)
	if _, err := manager.RoleBindings("ns"); err == nil {
		t.Fatalf("expected rolebindings list error")
	}
}
