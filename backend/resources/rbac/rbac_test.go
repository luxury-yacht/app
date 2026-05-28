/*
 * backend/resources/rbac/rbac_test.go
 *
 * Test helpers for RBAC resources.
 * - Provides shared helpers for RBAC tests.
 */

package rbac

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	"github.com/luxury-yacht/app/backend/testsupport"
	"k8s.io/client-go/kubernetes"
)

// newManagerWithClient is a test helper for building a service with a fake client.
func newManagerWithClient(client kubernetes.Interface) *Service {
	return NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
		ClusterID:        "cluster-a",
	})
}

func requireObjectRef(t testing.TB, refs []types.ObjectRef, index int, kind, namespace, name string) {
	t.Helper()
	if len(refs) <= index {
		t.Fatalf("expected ref at index %d, got %#v", index, refs)
	}
	ref := refs[index]
	group, version, resource := expectedObjectRefIdentity(t, kind)
	if ref.ClusterID != "cluster-a" || ref.Group != group || ref.Version != version || ref.Kind != kind || ref.Resource != resource || ref.Namespace != namespace || ref.Name != name {
		t.Fatalf("unexpected object ref: %#v", ref)
	}
}

func expectedObjectRefIdentity(t testing.TB, kind string) (string, string, string) {
	t.Helper()
	switch kind {
	case "ClusterRoleBinding":
		return "rbac.authorization.k8s.io", "v1", "clusterrolebindings"
	case "RoleBinding":
		return "rbac.authorization.k8s.io", "v1", "rolebindings"
	case "Pod":
		return "", "v1", "pods"
	case "Secret":
		return "", "v1", "secrets"
	default:
		t.Fatalf("missing expected object ref identity for kind %s", kind)
		return "", "", ""
	}
}
