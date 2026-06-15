package resourcestream

import (
	"testing"

	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/client-go/tools/cache"
)

func TestObjectAs(t *testing.T) {
	role := &rbacv1.Role{}

	if got, ok := objectAs[*rbacv1.Role](role); !ok || got != role {
		t.Fatalf("direct decode: got %v ok=%v", got, ok)
	}

	tomb := cache.DeletedFinalStateUnknown{Obj: role}
	if got, ok := objectAs[*rbacv1.Role](tomb); !ok || got != role {
		t.Fatalf("tombstone decode: got %v ok=%v", got, ok)
	}

	if _, ok := objectAs[*rbacv1.Role]("not a role"); ok {
		t.Fatal("expected miss for wrong type")
	}
}
