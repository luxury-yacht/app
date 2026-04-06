/*
 * backend/resources/generic/generic_collision_test.go
 *
 * Regression tests for the kind-only object identification bug in the
 * generic delete path. See docs/plans/kind-only-objects.md for the full
 * context. Mirrors the backend/object_yaml_collision_test.go tests but for
 * the delete-path resolver, which lives in its own package and cannot
 * import the backend package (see step 5 of the plan).
 */

package generic

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/testsupport"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
)

// collidingDBInstanceObjects returns two unstructured objects sharing
// namespace "default" and name "my-db", one under each of the colliding
// DBInstance CRDs. They carry a distinguishing spec.source field so tests
// can tell which one was touched.
func collidingDBInstanceObjects() (*unstructured.Unstructured, *unstructured.Unstructured) {
	ack := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "rds.services.k8s.aws/v1alpha1",
		"kind":       "DBInstance",
		"metadata": map[string]any{
			"name":      "my-db",
			"namespace": "default",
		},
		"spec": map[string]any{
			"source": "ack-rds",
		},
	}}
	ack.SetGroupVersionKind(schema.GroupVersionKind{
		Group: "rds.services.k8s.aws", Version: "v1alpha1", Kind: "DBInstance",
	})
	kindaRocks := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "kinda.rocks/v1beta1",
		"kind":       "DbInstance",
		"metadata": map[string]any{
			"name":      "my-db",
			"namespace": "default",
		},
		"spec": map[string]any{
			"source": "db-operator",
		},
	}}
	kindaRocks.SetGroupVersionKind(schema.GroupVersionKind{
		Group: "kinda.rocks", Version: "v1beta1", Kind: "DbInstance",
	})
	return ack, kindaRocks
}

// seedCollidingDBInstanceDiscovery configures the fake kubernetes client's
// discovery with both DBInstance GVs. Mirror of
// collidingDBInstanceDiscoveryLists in backend/object_yaml_collision_test.go,
// duplicated here because the `generic` package cannot import `backend` and
// the test only needs two API resource lists.
func seedCollidingDBInstanceDiscovery(t *testing.T, client *fake.Clientset) {
	t.Helper()
	ack := testsupport.NewAPIResourceList("rds.services.k8s.aws/v1alpha1", metav1.APIResource{
		Name:         "dbinstances",
		SingularName: "dbinstance",
		Namespaced:   true,
		Kind:         "DBInstance",
		Verbs:        metav1.Verbs{"get", "list", "watch", "delete"},
	})
	kindaRocks := testsupport.NewAPIResourceList("kinda.rocks/v1beta1", metav1.APIResource{
		Name:         "dbinstances",
		SingularName: "dbinstance",
		Namespaced:   true,
		Kind:         "DbInstance",
		Verbs:        metav1.Verbs{"get", "list", "watch", "delete"},
	})
	testsupport.SeedAPIResources(t, client, ack, kindaRocks)
}

// ackGVR and kindaRocksGVR match the discovery entries seeded above.
var (
	ackGVR = schema.GroupVersionResource{
		Group: "rds.services.k8s.aws", Version: "v1alpha1", Resource: "dbinstances",
	}
	kindaRocksGVR = schema.GroupVersionResource{
		Group: "kinda.rocks", Version: "v1beta1", Resource: "dbinstances",
	}
)

// TestServiceDeleteCollidingDBInstanceIsAmbiguous is a characterization
// test that documents the bug at the delete-path level. With two colliding
// DBInstance CRDs registered in discovery and two real objects (one per
// group, same name/namespace), the caller passes only the bare kind and
// the generic service picks whichever GVR discovery yields first. The
// caller has no way to express which one it actually wants to delete.
//
// After the fix, kind-only callers (used for built-in resources, no
// collisions) keep this arbitrary behavior and this test continues to
// pass. New callers that supply a GVK go through a different path (see
// the RED test below).
//
// We deliberately do not assert *which* object wins — the iteration order
// is a property of the fake client-go discovery, not a production
// invariant. What we lock in is:
//  1. Delete returns no error even though the request is ambiguous.
//  2. Exactly one of the two colliding objects was deleted.
//  3. The other remains.
func TestServiceDeleteCollidingDBInstanceIsAmbiguous(t *testing.T) {
	kubeClient := fake.NewClientset()
	seedCollidingDBInstanceDiscovery(t, kubeClient)

	ack, kindaRocks := collidingDBInstanceObjects()
	dynamicClient := testsupport.NewDynamicClient(t, nil, ack, kindaRocks)

	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	service := NewService(deps)

	if err := service.Delete("DBInstance", "default", "my-db"); err != nil {
		t.Fatalf("Delete returned error: %v", err)
	}

	ackExists := true
	if _, err := dynamicClient.Resource(ackGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); apierrors.IsNotFound(err) {
		ackExists = false
	} else if err != nil {
		t.Fatalf("unexpected error getting ACK object: %v", err)
	}

	kindaRocksExists := true
	if _, err := dynamicClient.Resource(kindaRocksGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); apierrors.IsNotFound(err) {
		kindaRocksExists = false
	} else if err != nil {
		t.Fatalf("unexpected error getting kinda.rocks object: %v", err)
	}

	switch {
	case ackExists && kindaRocksExists:
		t.Fatalf("no object was deleted; expected exactly one of the colliding DBInstance objects to be gone")
	case !ackExists && !kindaRocksExists:
		t.Fatalf("both objects were deleted; expected exactly one of the colliding DBInstance objects to remain")
	}
	// Log which side won so a human reviewing CI output can see the
	// ambiguity in action.
	switch {
	case !ackExists:
		t.Logf("bare-kind delete hit ack-rds DBInstance; kinda.rocks DbInstance survived — the caller had no way to choose")
	case !kindaRocksExists:
		t.Logf("bare-kind delete hit kinda.rocks DbInstance; ack-rds DBInstance survived — the caller had no way to choose")
	}
}

// TestServiceDeleteByGVKDisambiguatesCollidingDBInstances is the RED test
// that drives step 5 of the kind-only-objects fix. It exercises a new
// Service.DeleteByGVK method that does not yet have a real implementation
// — only a stub in delete_by_gvk.go that returns "not implemented".
//
// Expected state right now:
//   - The call compiles against the stub.
//   - The stub returns an error, so the test fails.
//
// Expected state after the fix lands (option (a) in plan step 5, the
// recommended path): Service.DeleteByGVK is replaced by a real
// implementation, or — equivalently — the `backend` caller resolves the
// GVR via getGVRForGVKWithDependencies and calls a renamed primitive on
// Service. Whatever the final shape, this test's assertions describe the
// user-visible behavior it has to deliver: given a GVK, the right object
// (and only the right object) is deleted.
func TestServiceDeleteByGVKDisambiguatesCollidingDBInstances(t *testing.T) {
	t.Run("ACK DBInstance", func(t *testing.T) {
		kubeClient := fake.NewClientset()
		seedCollidingDBInstanceDiscovery(t, kubeClient)

		ack, kindaRocks := collidingDBInstanceObjects()
		dynamicClient := testsupport.NewDynamicClient(t, nil, ack, kindaRocks)

		deps := testsupport.NewResourceDependencies(
			testsupport.WithDepsContext(context.Background()),
			testsupport.WithDepsKubeClient(kubeClient),
			testsupport.WithDepsDynamicClient(dynamicClient),
		)
		service := NewService(deps)

		err := service.DeleteByGVK(schema.GroupVersionKind{
			Group: "rds.services.k8s.aws", Version: "v1alpha1", Kind: "DBInstance",
		}, "default", "my-db")
		if err != nil {
			t.Fatalf("DeleteByGVK returned error for ACK: %v", err)
		}

		// ACK object should be gone.
		if _, err := dynamicClient.Resource(ackGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); !apierrors.IsNotFound(err) {
			t.Fatalf("expected ACK object to be deleted, got err=%v", err)
		}
		// kinda.rocks object must still be there — this is what the fix
		// buys us: choosing one does NOT touch the other.
		if _, err := dynamicClient.Resource(kindaRocksGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); err != nil {
			t.Fatalf("kinda.rocks object should still exist after ACK delete, got err=%v", err)
		}
	})

	t.Run("kinda.rocks DbInstance", func(t *testing.T) {
		kubeClient := fake.NewClientset()
		seedCollidingDBInstanceDiscovery(t, kubeClient)

		ack, kindaRocks := collidingDBInstanceObjects()
		dynamicClient := testsupport.NewDynamicClient(t, nil, ack, kindaRocks)

		deps := testsupport.NewResourceDependencies(
			testsupport.WithDepsContext(context.Background()),
			testsupport.WithDepsKubeClient(kubeClient),
			testsupport.WithDepsDynamicClient(dynamicClient),
		)
		service := NewService(deps)

		err := service.DeleteByGVK(schema.GroupVersionKind{
			Group: "kinda.rocks", Version: "v1beta1", Kind: "DbInstance",
		}, "default", "my-db")
		if err != nil {
			t.Fatalf("DeleteByGVK returned error for kinda.rocks: %v", err)
		}

		if _, err := dynamicClient.Resource(kindaRocksGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); !apierrors.IsNotFound(err) {
			t.Fatalf("expected kinda.rocks object to be deleted, got err=%v", err)
		}
		if _, err := dynamicClient.Resource(ackGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); err != nil {
			t.Fatalf("ACK object should still exist after kinda.rocks delete, got err=%v", err)
		}
	})
}
