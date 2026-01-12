package rbac

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	clientgotesting "k8s.io/client-go/testing"
)

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
	manager := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
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
