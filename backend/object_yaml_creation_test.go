package backend

import (
	"context"
	"fmt"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation/field"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

// setupCreationTestApp creates an App with fake clients and an empty cluster
// (no pre-existing resources). Discovery is configured for apps/v1 Deployments,
// v1 ConfigMaps, and v1 Namespaces. No GVR cache is seeded because
// resolveGVRStrict queries discovery directly.
func setupCreationTestApp(t *testing.T) (*App, *dynamicfake.FakeDynamicClient, string) {
	t.Helper()

	scheme := runtime.NewScheme()
	if err := appsv1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to register apps scheme: %v", err)
	}
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to register core scheme: %v", err)
	}

	client := clientfake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", SingularName: "deployment", Kind: "Deployment", Namespaced: true, Verbs: metav1.Verbs{"create", "get", "list"}},
			},
		},
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{Name: "configmaps", SingularName: "configmap", Kind: "ConfigMap", Namespaced: true, Verbs: metav1.Verbs{"create", "get", "list"}},
				{Name: "namespaces", SingularName: "namespace", Kind: "Namespace", Namespaced: false, Verbs: metav1.Verbs{"create", "get", "list"}},
			},
		},
	}

	dynamicClient := dynamicfake.NewSimpleDynamicClient(scheme)

	// Pass-through reactor that returns the created object (default behavior).
	dynamicClient.Fake.PrependReactor("create", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		return false, createAction.GetObject().DeepCopyObject(), nil
	})

	app := NewApp()
	app.Ctx = context.Background()
	apiExtClient := apiextensionsfake.NewClientset()
	clusterID := "config:test-ctx"
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:                ClusterMeta{ID: clusterID, Name: "test-ctx"},
			kubeconfigPath:      "/test",
			kubeconfigContext:   "test-ctx",
			client:              client,
			dynamicClient:       dynamicClient,
			apiextensionsClient: apiExtClient,
		},
	}

	return app, dynamicClient, clusterID
}

// validDeploymentYAML is a minimal valid Deployment YAML for tests.
const validDeploymentYAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-deploy
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: test
  template:
    metadata:
      labels:
        app: test
    spec:
      containers:
      - name: app
        image: nginx:latest`

func TestValidateResourceCreationSuccess(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	resp, err := app.ValidateResourceCreation(clusterID, ResourceCreationRequest{YAML: validDeploymentYAML})
	if err != nil {
		t.Fatalf("ValidateResourceCreation returned error: %v", err)
	}
	if resp == nil {
		t.Fatal("expected response, got nil")
	}
	if resp.Kind != "Deployment" {
		t.Fatalf("expected kind Deployment, got %s", resp.Kind)
	}
	if resp.Name != "test-deploy" {
		t.Fatalf("expected name test-deploy, got %s", resp.Name)
	}
}

func TestCreateResourceSuccess(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	resp, err := app.CreateResource(clusterID, ResourceCreationRequest{YAML: validDeploymentYAML})
	if err != nil {
		t.Fatalf("CreateResource returned error: %v", err)
	}
	if resp.Name != "test-deploy" {
		t.Fatalf("expected name test-deploy, got %s", resp.Name)
	}
	if resp.Namespace != "default" {
		t.Fatalf("expected namespace default, got %s", resp.Namespace)
	}
}

func TestCreateResourceNamespaceOverride(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	req := ResourceCreationRequest{
		YAML:      validDeploymentYAML,
		Namespace: "overridden",
	}

	resp, err := app.CreateResource(clusterID, req)
	if err != nil {
		t.Fatalf("CreateResource returned error: %v", err)
	}
	if resp.Namespace != "overridden" {
		t.Fatalf("expected namespace overridden, got %s", resp.Namespace)
	}
}

func TestCreateResourceEmptyYAML(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	_, err := app.CreateResource(clusterID, ResourceCreationRequest{YAML: ""})
	if err == nil {
		t.Fatal("expected error for empty YAML")
	}
}

func TestCreateResourceMissingName(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	req := ResourceCreationRequest{
		YAML: `apiVersion: v1
kind: ConfigMap
metadata:
  namespace: default
data:
  key: value`,
	}

	_, err := app.CreateResource(clusterID, req)
	if err == nil {
		t.Fatal("expected error for missing name")
	}
}

func TestCreateResourceMissingKind(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	req := ResourceCreationRequest{
		YAML: `apiVersion: v1
metadata:
  name: test
  namespace: default`,
	}

	_, err := app.CreateResource(clusterID, req)
	if err == nil {
		t.Fatal("expected error for missing kind")
	}
}

func TestCreateResourceInvalidCluster(t *testing.T) {
	app, _, _ := setupCreationTestApp(t)

	_, err := app.CreateResource("nonexistent:cluster", ResourceCreationRequest{YAML: validDeploymentYAML})
	if err == nil {
		t.Fatal("expected error for invalid cluster")
	}
}

func TestCreateResourceStripsServerFields(t *testing.T) {
	app, dynamicClient, clusterID := setupCreationTestApp(t)

	var createdObj *unstructured.Unstructured
	dynamicClient.Fake.PrependReactor("create", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		createdObj = createAction.GetObject().(*unstructured.Unstructured).DeepCopy()
		return false, createdObj, nil
	})

	req := ResourceCreationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: has-server-fields
  namespace: default
  resourceVersion: "12345"
  uid: "abc-123"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: test
  template:
    metadata:
      labels:
        app: test
    spec:
      containers:
      - name: app
        image: nginx:latest`,
	}

	_, err := app.CreateResource(clusterID, req)
	if err != nil {
		t.Fatalf("CreateResource returned error: %v", err)
	}
	if createdObj == nil {
		t.Fatal("create reactor did not capture object")
	}
	if createdObj.GetResourceVersion() != "" {
		t.Fatalf("expected empty resourceVersion, got %s", createdObj.GetResourceVersion())
	}
	if string(createdObj.GetUID()) != "" {
		t.Fatalf("expected empty UID, got %s", createdObj.GetUID())
	}
}

func TestCreateResourceAlreadyExists(t *testing.T) {
	app, dynamicClient, clusterID := setupCreationTestApp(t)

	dynamicClient.Fake.PrependReactor("create", "deployments", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewAlreadyExists(
			schema.GroupResource{Group: "apps", Resource: "deployments"},
			"existing-deploy",
		)
	})

	_, err := app.CreateResource(clusterID, ResourceCreationRequest{YAML: validDeploymentYAML})
	if err == nil {
		t.Fatal("expected AlreadyExists error")
	}
	errStr := err.Error()
	if !strings.Contains(errStr, "AlreadyExists") {
		t.Fatalf("expected AlreadyExists in error, got: %s", errStr)
	}
}

func TestCreateResourceForbidden(t *testing.T) {
	app, dynamicClient, clusterID := setupCreationTestApp(t)

	dynamicClient.Fake.PrependReactor("create", "deployments", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Group: "apps", Resource: "deployments"},
			"forbidden-deploy",
			fmt.Errorf("user cannot create deployments in namespace default"),
		)
	})

	_, err := app.CreateResource(clusterID, ResourceCreationRequest{YAML: validDeploymentYAML})
	if err == nil {
		t.Fatal("expected Forbidden error")
	}
	errStr := err.Error()
	if !strings.Contains(errStr, "Forbidden") {
		t.Fatalf("expected Forbidden in error, got: %s", errStr)
	}
}

func TestCreateResourceInvalid(t *testing.T) {
	app, dynamicClient, clusterID := setupCreationTestApp(t)

	dynamicClient.Fake.PrependReactor("create", "deployments", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewInvalid(
			schema.GroupKind{Group: "apps", Kind: "Deployment"},
			"invalid-deploy",
			field.ErrorList{
				field.Required(field.NewPath("spec", "selector"), "selector is required"),
			},
		)
	})

	_, err := app.CreateResource(clusterID, ResourceCreationRequest{YAML: validDeploymentYAML})
	if err == nil {
		t.Fatal("expected Invalid error")
	}
	errStr := err.Error()
	if !strings.Contains(errStr, "Invalid") {
		t.Fatalf("expected Invalid in error, got: %s", errStr)
	}
	// Verify structured causes are present in the objectYAMLError JSON.
	if !strings.Contains(errStr, "causes") {
		t.Fatalf("expected field-level causes in error, got: %s", errStr)
	}
}

func TestValidateResourceCreationCallsCreate(t *testing.T) {
	// Verify that ValidateResourceCreation actually calls Create (dry-run).
	// The fake client can't distinguish dry-run from real, but we can verify
	// the create action was called and the method returned successfully.
	app, dynamicClient, clusterID := setupCreationTestApp(t)

	createCalled := false
	dynamicClient.Fake.PrependReactor("create", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createCalled = true
		createAction := action.(cgotesting.CreateAction)
		return false, createAction.GetObject().DeepCopyObject(), nil
	})

	resp, err := app.ValidateResourceCreation(clusterID, ResourceCreationRequest{YAML: validDeploymentYAML})
	if err != nil {
		t.Fatalf("ValidateResourceCreation returned error: %v", err)
	}
	if !createCalled {
		t.Fatal("expected create to be called during validation")
	}
	if resp.Name != "test-deploy" {
		t.Fatalf("expected name test-deploy, got %s", resp.Name)
	}
}

// TestCreateResourceStrictGVRResolution verifies that resolveGVRStrict does NOT
// fall back to kind-only matching. This is a regression test: if someone replaces
// resolveGVRStrict with getGVRForGVKWithDependencies, this test must fail.
func TestCreateResourceStrictGVRResolution(t *testing.T) {
	scheme := runtime.NewScheme()
	if err := appsv1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to register apps scheme: %v", err)
	}
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to register core scheme: %v", err)
	}

	client := clientfake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	// Register two groups with the same Kind "Widget" in different groups.
	// Only "stable.example.com/v1" should be resolved for apiVersion: stable.example.com/v1.
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "unstable.example.com/v1beta1",
			APIResources: []metav1.APIResource{
				{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: metav1.Verbs{"create"}},
			},
		},
		{
			GroupVersion: "stable.example.com/v1",
			APIResources: []metav1.APIResource{
				{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: metav1.Verbs{"create"}},
			},
		},
	}

	dynamicClient := dynamicfake.NewSimpleDynamicClient(scheme)
	app := NewApp()
	app.Ctx = context.Background()
	clusterID := "config:gvr-test"
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "gvr-test"},
			kubeconfigPath:    "/test",
			kubeconfigContext: "gvr-test",
			client:            client,
			dynamicClient:     dynamicClient,
		},
	}

	// Request creation with stable.example.com/v1 — must resolve to stable, not unstable.
	var capturedGVR schema.GroupVersionResource
	dynamicClient.Fake.PrependReactor("create", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		capturedGVR = action.GetResource()
		createAction := action.(cgotesting.CreateAction)
		return false, createAction.GetObject().DeepCopyObject(), nil
	})

	req := ResourceCreationRequest{
		YAML: `apiVersion: stable.example.com/v1
kind: Widget
metadata:
  name: my-widget
  namespace: default
spec:
  color: blue`,
	}

	_, err := app.CreateResource(clusterID, req)
	if err != nil {
		t.Fatalf("CreateResource returned error: %v", err)
	}
	if capturedGVR.Group != "stable.example.com" {
		t.Fatalf("expected group stable.example.com, got %q", capturedGVR.Group)
	}
	if capturedGVR.Version != "v1" {
		t.Fatalf("expected version v1, got %q", capturedGVR.Version)
	}

	// Request with a non-existent group — must FAIL, not fall back to kind-only match.
	reqBadGroup := ResourceCreationRequest{
		YAML: `apiVersion: nonexistent.example.com/v1
kind: Widget
metadata:
  name: bad-widget
  namespace: default
spec:
  color: red`,
	}

	_, err = app.CreateResource(clusterID, reqBadGroup)
	if err == nil {
		t.Fatal("expected error for non-existent group; strict resolution must not fall back to kind-only matching")
	}
}

func TestCreateResourceClusterScopedIgnoresNamespace(t *testing.T) {
	app, dynamicClient, clusterID := setupCreationTestApp(t)

	var createdObj *unstructured.Unstructured
	dynamicClient.Fake.PrependReactor("create", "namespaces", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		createdObj = createAction.GetObject().(*unstructured.Unstructured).DeepCopy()
		return false, createdObj, nil
	})

	req := ResourceCreationRequest{
		YAML: `apiVersion: v1
kind: Namespace
metadata:
  name: my-new-ns
  namespace: should-be-stripped`,
	}

	resp, err := app.CreateResource(clusterID, req)
	if err != nil {
		t.Fatalf("CreateResource returned error: %v", err)
	}
	if resp.Namespace != "" {
		t.Fatalf("expected empty namespace for cluster-scoped resource, got %q", resp.Namespace)
	}
	if createdObj != nil && createdObj.GetNamespace() != "" {
		t.Fatalf("expected namespace stripped from object, got %q", createdObj.GetNamespace())
	}
}

func TestCreateResourceNamespacedMissingNamespace(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	req := ResourceCreationRequest{
		YAML: `apiVersion: v1
kind: ConfigMap
metadata:
  name: no-namespace
data:
  key: value`,
	}

	_, err := app.CreateResource(clusterID, req)
	if err == nil {
		t.Fatal("expected error for namespaced resource without namespace")
	}
	if !strings.Contains(err.Error(), "namespace") {
		t.Fatalf("expected namespace-related error, got: %v", err)
	}
}
