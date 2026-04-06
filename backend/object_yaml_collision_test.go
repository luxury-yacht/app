/*
 * backend/object_yaml_collision_test.go
 *
 * Regression tests for the kind-only object identification bug.
 * See docs/plans/kind-only-objects.md for the full context.
 *
 * Scenario: a cluster has two CRDs whose lowercased kind collapses to
 * "dbinstance" but which come from different API groups:
 *   - AWS Controllers for Kubernetes (ACK) RDS: rds.services.k8s.aws/v1alpha1, kind DBInstance
 *   - db-operator:                               kinda.rocks/v1beta1,           kind DbInstance
 *
 * Both are real CRDs shipped by upstream operators, verified against their
 * public CRD YAMLs. Their plural path is "dbinstances" in both cases, and
 * their kind names differ only in case — strings.EqualFold treats them as
 * identical.
 */

package backend

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/luxury-yacht/app/backend/capabilities"
	authorizationv1 "k8s.io/api/authorization/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

// ackDBInstanceGVK is the GVK for the AWS Controllers for Kubernetes RDS DBInstance.
var ackDBInstanceGVK = schema.GroupVersionKind{
	Group:   "rds.services.k8s.aws",
	Version: "v1alpha1",
	Kind:    "DBInstance",
}

// kindaRocksDBInstanceGVK is the GVK for the db-operator DbInstance.
// Note the case difference: "DbInstance" vs "DBInstance". strings.EqualFold
// treats them as matching, which is the core of the collision.
var kindaRocksDBInstanceGVK = schema.GroupVersionKind{
	Group:   "kinda.rocks",
	Version: "v1beta1",
	Kind:    "DbInstance",
}

// collidingDBInstanceCRDs returns the two upstream CRDs that collide on the
// lowercased kind "dbinstance". Used by both the object_yaml and resources/generic
// collision tests.
func collidingDBInstanceCRDs() (*apiextensionsv1.CustomResourceDefinition, *apiextensionsv1.CustomResourceDefinition) {
	ack := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "dbinstances.rds.services.k8s.aws"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "rds.services.k8s.aws",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural:   "dbinstances",
				Singular: "dbinstance",
				Kind:     "DBInstance",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name: "v1alpha1", Served: true, Storage: true,
			}},
		},
	}
	kindaRocks := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "dbinstances.kinda.rocks"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "kinda.rocks",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural:   "dbinstances",
				Singular: "dbinstance",
				Kind:     "DbInstance",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name: "v1beta1", Served: true, Storage: true,
			}},
		},
	}
	return ack, kindaRocks
}

// collidingDBInstanceDiscoveryLists returns the two APIResourceList entries
// that a fake discovery client should publish to simulate both CRDs being
// registered in the cluster. The ACK entry is listed first; tests that
// depend on ordering should document the assumption.
func collidingDBInstanceDiscoveryLists() []*metav1.APIResourceList {
	ack := &metav1.APIResourceList{
		GroupVersion: "rds.services.k8s.aws/v1alpha1",
		APIResources: []metav1.APIResource{{
			Name:         "dbinstances",
			SingularName: "dbinstance",
			Namespaced:   true,
			Kind:         "DBInstance",
			Verbs:        metav1.Verbs{"get", "list", "watch", "create", "update", "delete"},
		}},
	}
	kindaRocks := &metav1.APIResourceList{
		GroupVersion: "kinda.rocks/v1beta1",
		APIResources: []metav1.APIResource{{
			Name:         "dbinstances",
			SingularName: "dbinstance",
			Namespaced:   true,
			Kind:         "DbInstance",
			Verbs:        metav1.Verbs{"get", "list", "watch", "create", "update", "delete"},
		}},
	}
	return []*metav1.APIResourceList{ack, kindaRocks}
}

// newCollidingDBInstanceCluster wires a test cluster with a fake kubernetes
// client whose discovery publishes both colliding DBInstance kinds, a fake
// apiextensions client that holds both CRDs, and a fake dynamic client seeded
// with one object of each kind. Both objects share namespace "default" and
// name "my-db" so they can only be disambiguated by apiVersion.
//
// The dynamic-client objects carry a distinguishing spec.source field so tests
// can tell which one came back.
func newCollidingDBInstanceCluster(t *testing.T, clusterID string) *App {
	t.Helper()

	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	kubeClient := kubernetesfake.NewClientset()
	discoveryClient := kubeClient.Discovery().(*fakediscovery.FakeDiscovery)
	discoveryClient.Resources = collidingDBInstanceDiscoveryLists()

	ackCRD, kindaRocksCRD := collidingDBInstanceCRDs()
	apiExtClient := apiextensionsfake.NewClientset(ackCRD, kindaRocksCRD)

	ackObj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "rds.services.k8s.aws/v1alpha1",
		"kind":       "DBInstance",
		"metadata": map[string]any{
			"name":            "my-db",
			"namespace":       "default",
			"resourceVersion": "100",
		},
		"spec": map[string]any{
			"source": "ack-rds",
		},
	}}
	ackObj.SetGroupVersionKind(ackDBInstanceGVK)

	kindaRocksObj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "kinda.rocks/v1beta1",
		"kind":       "DbInstance",
		"metadata": map[string]any{
			"name":            "my-db",
			"namespace":       "default",
			"resourceVersion": "200",
		},
		"spec": map[string]any{
			"source": "db-operator",
		},
	}}
	kindaRocksObj.SetGroupVersionKind(kindaRocksDBInstanceGVK)

	dynamicClient := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), ackObj, kindaRocksObj)

	registerTestClusterWithClients(app, clusterID, &clusterClients{
		meta:                ClusterMeta{ID: clusterID, Name: "ctx"},
		kubeconfigPath:      "/path",
		kubeconfigContext:   "ctx",
		client:              kubeClient,
		dynamicClient:       dynamicClient,
		apiextensionsClient: apiExtClient,
	})
	return app
}

// TestGetGVRForGVKDisambiguatesCollidingDBInstanceCRDs is a GREEN guardrail
// regression test. It locks in that the existing getGVRForGVKWithDependencies
// helper — the reference resolver we plan to route read/delete/capability
// callers through — correctly disambiguates two CRDs that share a kind.
//
// This test should PASS immediately. If it ever starts failing, the exact-GVK
// helper has regressed and the entire kind-only-objects fix is at risk.
func TestGetGVRForGVKDisambiguatesCollidingDBInstanceCRDs(t *testing.T) {
	const clusterID = "collision-gvk"
	app := newCollidingDBInstanceCluster(t, clusterID)

	deps, _, err := app.resolveClusterDependencies(clusterID)
	if err != nil {
		t.Fatalf("resolveClusterDependencies: %v", err)
	}

	t.Run("ACK DBInstance", func(t *testing.T) {
		gvr, namespaced, err := getGVRForGVKWithDependencies(context.Background(), deps, clusterID, ackDBInstanceGVK)
		if err != nil {
			t.Fatalf("getGVRForGVKWithDependencies returned error for ACK GVK: %v", err)
		}
		want := schema.GroupVersionResource{
			Group: "rds.services.k8s.aws", Version: "v1alpha1", Resource: "dbinstances",
		}
		if gvr != want {
			t.Fatalf("wrong GVR for ACK DBInstance: got %v, want %v", gvr, want)
		}
		if !namespaced {
			t.Fatalf("expected ACK DBInstance to be namespaced")
		}
	})

	t.Run("db-operator DbInstance", func(t *testing.T) {
		gvr, namespaced, err := getGVRForGVKWithDependencies(context.Background(), deps, clusterID, kindaRocksDBInstanceGVK)
		if err != nil {
			t.Fatalf("getGVRForGVKWithDependencies returned error for kinda.rocks GVK: %v", err)
		}
		want := schema.GroupVersionResource{
			Group: "kinda.rocks", Version: "v1beta1", Resource: "dbinstances",
		}
		if gvr != want {
			t.Fatalf("wrong GVR for kinda.rocks DbInstance: got %v, want %v", gvr, want)
		}
		if !namespaced {
			t.Fatalf("expected kinda.rocks DbInstance to be namespaced")
		}
	})
}

// TestGetGVRForDependenciesCollidingDBInstanceReturnsArbitraryMatch
// (removed) used to characterize the first-match-wins behavior of the
// legacy getGVRForDependencies resolver. That resolver was deleted as
// part of the kind-only-objects fix — every production caller now
// routes through common.ResolveGVRForGVK (strict) or
// common.DiscoverGVRByKind (explicitly documented as non-deterministic
// for colliding kinds, used only as a partial-discovery safety net in
// the mutation path). The GVK-aware disambiguation is covered by
// TestGetGVRForGVKDisambiguatesCollidingDBInstanceCRDs above.

// TestGetObjectYAMLByGVKDisambiguatesCollidingDBInstances is the RED test
// that drives step 3 of the kind-only-objects fix. It exercises the
// not-yet-implemented GVK-aware entry point on *App via a temporary stub.
//
// Expected state right now:
//   - The call compiles against the stub in object_yaml_by_gvk.go.
//   - The stub returns an "not implemented" error, so the test fails.
//
// Expected state after the fix lands:
//   - The stub is replaced with a real implementation that routes through
//     getGVRForGVKWithDependencies and the dynamic client.
//   - Each subtest returns the YAML bytes for its own colliding object,
//     identifiable by the "source" field seeded on the fixture.
//
// The objects were seeded with distinct spec.source values ("ack-rds" and
// "db-operator") specifically so the assertions below cannot pass if the
// implementation routes to the wrong GVR.
func TestGetObjectYAMLByGVKDisambiguatesCollidingDBInstances(t *testing.T) {
	const clusterID = "collision-by-gvk"
	app := newCollidingDBInstanceCluster(t, clusterID)

	t.Run("ACK DBInstance returns ack-rds YAML", func(t *testing.T) {
		yamlStr, err := app.GetObjectYAMLByGVK(clusterID, "rds.services.k8s.aws/v1alpha1", "DBInstance", "default", "my-db")
		if err != nil {
			t.Fatalf("GetObjectYAMLByGVK returned error for ACK: %v", err)
		}
		if !strings.Contains(yamlStr, "source: ack-rds") {
			t.Fatalf("expected ACK object YAML to contain 'source: ack-rds', got:\n%s", yamlStr)
		}
		if strings.Contains(yamlStr, "source: db-operator") {
			t.Fatalf("ACK lookup returned db-operator object by mistake:\n%s", yamlStr)
		}
	})

	t.Run("kinda.rocks DbInstance returns db-operator YAML", func(t *testing.T) {
		yamlStr, err := app.GetObjectYAMLByGVK(clusterID, "kinda.rocks/v1beta1", "DbInstance", "default", "my-db")
		if err != nil {
			t.Fatalf("GetObjectYAMLByGVK returned error for kinda.rocks: %v", err)
		}
		if !strings.Contains(yamlStr, "source: db-operator") {
			t.Fatalf("expected kinda.rocks object YAML to contain 'source: db-operator', got:\n%s", yamlStr)
		}
		if strings.Contains(yamlStr, "source: ack-rds") {
			t.Fatalf("kinda.rocks lookup returned ack-rds object by mistake:\n%s", yamlStr)
		}
	})
}

// TestQueryPermissionsDisambiguatesCollidingDBInstances is the step-4
// acceptance test. It exercises App.QueryPermissions with two
// PermissionQuery items that differ ONLY in Group/Version and asserts
// that the SSAR call for each query lands against the correct API
// group. Before step 4, QueryPermissions resolved the GVR with a
// kind-only first-match-wins walk and could gate the same verb on the
// wrong operator's DBInstance.
//
// Shape of the test:
//  1. Install the colliding DBInstance fixture via newCollidingDBInstanceCluster.
//  2. Install a selfsubjectrulesreview reactor that returns Incomplete=true
//     so every query falls through SSRR cache matching into the SSAR
//     fallback path (where we can inspect the outgoing attributes).
//  3. Install a selfsubjectaccessreviews reactor that records the
//     ResourceAttributes for every SSAR call and returns Allowed=true.
//  4. Call QueryPermissions with one query per colliding GVK.
//  5. Assert both queries succeeded AND that the SSAR reactor saw each
//     Group (rds.services.k8s.aws and kinda.rocks) exactly once, each
//     paired with the expected plural resource "dbinstances".
func TestQueryPermissionsDisambiguatesCollidingDBInstances(t *testing.T) {
	const clusterID = "collision-capabilities"
	app := newCollidingDBInstanceCluster(t, clusterID)

	kubeClient := app.clusterClients[clusterID].client.(*kubernetesfake.Clientset)

	// Force SSAR fallback for every query: SSRR returns Incomplete so no
	// query matches a cached rule, and Incomplete=true routes through SSAR.
	kubeClient.Fake.PrependReactor("create", "selfsubjectrulesreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectRulesReview)
		review.Status = authorizationv1.SubjectRulesReviewStatus{
			Incomplete:    true,
			ResourceRules: []authorizationv1.ResourceRule{},
		}
		return true, review, nil
	})

	// Capture every SSAR call's ResourceAttributes and return Allowed=true.
	var (
		recordedMu sync.Mutex
		recorded   []authorizationv1.ResourceAttributes
	)
	kubeClient.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		if review.Spec.ResourceAttributes != nil {
			recordedMu.Lock()
			recorded = append(recorded, *review.Spec.ResourceAttributes)
			recordedMu.Unlock()
		}
		review.Status = authorizationv1.SubjectAccessReviewStatus{Allowed: true}
		return true, review, nil
	})

	queries := []capabilities.PermissionQuery{
		{
			ID:           "view-ack",
			ClusterId:    clusterID,
			Group:        "rds.services.k8s.aws",
			Version:      "v1alpha1",
			ResourceKind: "DBInstance",
			Verb:         "get",
			Namespace:    "default",
			Name:         "my-db",
		},
		{
			ID:           "view-kinda-rocks",
			ClusterId:    clusterID,
			Group:        "kinda.rocks",
			Version:      "v1beta1",
			ResourceKind: "DbInstance",
			Verb:         "get",
			Namespace:    "default",
			Name:         "my-db",
		},
	}

	resp, err := app.QueryPermissions(queries)
	if err != nil {
		t.Fatalf("QueryPermissions returned error: %v", err)
	}
	if len(resp.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(resp.Results))
	}
	for _, r := range resp.Results {
		if r.Source == "error" {
			t.Fatalf("query %q unexpectedly errored: %s", r.ID, r.Error)
		}
		if !r.Allowed {
			t.Fatalf("query %q expected Allowed=true from reactor, got Allowed=false (source=%s reason=%s)", r.ID, r.Source, r.Reason)
		}
	}

	recordedMu.Lock()
	snapshot := append([]authorizationv1.ResourceAttributes(nil), recorded...)
	recordedMu.Unlock()

	if len(snapshot) < 2 {
		t.Fatalf("expected at least 2 SSAR calls, got %d: %+v", len(snapshot), snapshot)
	}

	// Count groups seen. Each colliding DBInstance should produce exactly
	// one SSAR call against its own group — the bug before step 4 would
	// either send both to whichever group discovery yielded first or send
	// both to the same group.
	groupCounts := map[string]int{}
	for _, attrs := range snapshot {
		groupCounts[attrs.Group]++
		if attrs.Resource != "dbinstances" {
			t.Errorf("unexpected resource %q in SSAR call (attrs=%+v)", attrs.Resource, attrs)
		}
		if attrs.Verb != "get" {
			t.Errorf("unexpected verb %q in SSAR call (attrs=%+v)", attrs.Verb, attrs)
		}
	}

	if groupCounts["rds.services.k8s.aws"] != 1 {
		t.Errorf("expected exactly 1 SSAR against rds.services.k8s.aws, got %d (all groups seen: %+v)", groupCounts["rds.services.k8s.aws"], groupCounts)
	}
	if groupCounts["kinda.rocks"] != 1 {
		t.Errorf("expected exactly 1 SSAR against kinda.rocks, got %d (all groups seen: %+v)", groupCounts["kinda.rocks"], groupCounts)
	}
}

// TestDeleteResourceByGVKDisambiguatesCollidingDBInstances is the
// step-5 wrapper acceptance test. It exercises the *App-level
// DeleteResourceByGVK Wails entry point (not the lower-level
// generic.Service.DeleteByGVK already covered by
// TestServiceDeleteByGVKDisambiguatesCollidingDBInstances in the
// generic package).
//
// This wrapper is what the Wails-bound frontend actually calls. The
// test verifies the full path: the apiVersion string is parsed into a
// GVK, dependencies are resolved for the cluster, and generic.Service's
// DeleteByGVK is invoked with the right GVK. The net effect is that
// each colliding DBInstance object can be deleted independently, and
// deleting one leaves the other untouched.
func TestDeleteResourceByGVKDisambiguatesCollidingDBInstances(t *testing.T) {
	t.Run("ACK DBInstance", func(t *testing.T) {
		const clusterID = "collision-delete-ack"
		app := newCollidingDBInstanceCluster(t, clusterID)
		dynamicClient := app.clusterClients[clusterID].dynamicClient.(*dynamicfake.FakeDynamicClient)

		if err := app.DeleteResourceByGVK(clusterID, "rds.services.k8s.aws/v1alpha1", "DBInstance", "default", "my-db"); err != nil {
			t.Fatalf("DeleteResourceByGVK returned error for ACK: %v", err)
		}

		ackGVR := schema.GroupVersionResource{
			Group: "rds.services.k8s.aws", Version: "v1alpha1", Resource: "dbinstances",
		}
		kindaRocksGVR := schema.GroupVersionResource{
			Group: "kinda.rocks", Version: "v1beta1", Resource: "dbinstances",
		}

		if _, err := dynamicClient.Resource(ackGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); err == nil {
			t.Fatalf("expected ACK DBInstance to be deleted, but it still exists")
		}
		// The db-operator object must survive.
		if _, err := dynamicClient.Resource(kindaRocksGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); err != nil {
			t.Fatalf("kinda.rocks DbInstance should still exist after ACK delete, got err=%v", err)
		}
	})

	t.Run("kinda.rocks DbInstance", func(t *testing.T) {
		const clusterID = "collision-delete-kinda-rocks"
		app := newCollidingDBInstanceCluster(t, clusterID)
		dynamicClient := app.clusterClients[clusterID].dynamicClient.(*dynamicfake.FakeDynamicClient)

		if err := app.DeleteResourceByGVK(clusterID, "kinda.rocks/v1beta1", "DbInstance", "default", "my-db"); err != nil {
			t.Fatalf("DeleteResourceByGVK returned error for kinda.rocks: %v", err)
		}

		ackGVR := schema.GroupVersionResource{
			Group: "rds.services.k8s.aws", Version: "v1alpha1", Resource: "dbinstances",
		}
		kindaRocksGVR := schema.GroupVersionResource{
			Group: "kinda.rocks", Version: "v1beta1", Resource: "dbinstances",
		}

		if _, err := dynamicClient.Resource(kindaRocksGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); err == nil {
			t.Fatalf("expected kinda.rocks DbInstance to be deleted, but it still exists")
		}
		// The ACK object must survive.
		if _, err := dynamicClient.Resource(ackGVR).Namespace("default").Get(context.Background(), "my-db", metav1.GetOptions{}); err != nil {
			t.Fatalf("ACK DBInstance should still exist after kinda.rocks delete, got err=%v", err)
		}
	})

	t.Run("missing apiVersion returns error", func(t *testing.T) {
		const clusterID = "collision-delete-missing-version"
		app := newCollidingDBInstanceCluster(t, clusterID)

		err := app.DeleteResourceByGVK(clusterID, "", "DBInstance", "default", "my-db")
		if err == nil {
			t.Fatal("expected error when apiVersion is empty")
		}
		if !strings.Contains(err.Error(), "apiVersion") {
			t.Errorf("expected error to mention apiVersion, got %v", err)
		}
	})
}
