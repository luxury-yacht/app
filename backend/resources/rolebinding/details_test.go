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
