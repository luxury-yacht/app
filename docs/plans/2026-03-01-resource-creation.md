# Resource Creation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to create any Kubernetes resource via a YAML editor modal with curated starter templates, server-side dry-run validation, and freeform YAML support.

**Architecture:** Backend exposes `ValidateResourceCreation` and `CreateResource` methods on the `App` struct using the dynamic client (same pattern as `object_yaml_mutation.go`). Frontend adds a `CreateResourceModal` triggered from the command palette, reusing CodeMirror and existing error display patterns.

**Tech Stack:** Go (dynamic client, API discovery), React + TypeScript, CodeMirror (`@uiw/react-codemirror`), Wails v2 bindings, Vitest

**Design doc:** `docs/plans/2026-03-01-resource-creation-design.md`

---

## Task 1: Backend — Resource Creation Types and Core Logic ✅

**Files:**
- Create: `backend/object_yaml_creation.go`
- Reference: `backend/object_yaml_mutation.go` (reuse `parseYAMLToUnstructured`, `wrapKubernetesError`, `mutationContext`)
- Reference: `backend/object_yaml.go` (strict GVR resolution — do NOT use the `getGVRForDependencies` kind-only fallback)

**Step 1: Write the failing test**

Create `backend/object_yaml_creation_test.go`. Use the same test helper pattern from `object_yaml_mutation_test.go` — fake clients, fake discovery, GVR cache setup. The setup helper should NOT create an initial object (unlike the mutation tests which pre-populate a Deployment), since creation targets resources that don't exist yet.

```go
package backend

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation/field"
	cgotesting "k8s.io/client-go/testing"
	clientfake "k8s.io/client-go/kubernetes/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	fakediscovery "k8s.io/client-go/discovery/fake"
)

// setupCreationTestApp creates an App with fake clients and an empty cluster
// (no pre-existing resources). The dynamic client's "create" reactor stores
// created objects so tests can inspect them.
func setupCreationTestApp(t *testing.T) (*App, *dynamicfake.FakeDynamicClient, string) {
	scheme := runtime.NewScheme()
	if err := appsv1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to register apps scheme: %v", err)
	}

	client := clientfake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Kind: "Deployment", Namespaced: true, Verbs: metav1.Verbs{"create", "get", "list"}},
			},
		},
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{Name: "configmaps", Kind: "ConfigMap", Namespaced: true, Verbs: metav1.Verbs{"create", "get", "list"}},
				{Name: "namespaces", Kind: "Namespace", Namespaced: false, Verbs: metav1.Verbs{"create", "get", "list"}},
			},
		},
	}

	dynamicClient := dynamicfake.NewSimpleDynamicClient(scheme)

	// Track created objects for assertions
	dynamicClient.Fake.PrependReactor("create", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		obj := createAction.GetObject().DeepCopyObject()
		return false, obj, nil
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

	// Pre-populate GVR cache for test cluster
	cacheKey := gvrCacheKey(clusterID, "Deployment")
	gvrCacheMutex.Lock()
	gvrCache[cacheKey] = gvrCacheEntry{
		gvr:        appsv1.SchemeGroupVersion.WithResource("deployments"),
		namespaced: true,
		cachedAt:   time.Now(),
	}
	gvrCacheMutex.Unlock()

	t.Cleanup(func() {
		gvrCacheMutex.Lock()
		delete(gvrCache, cacheKey)
		gvrCacheMutex.Unlock()
	})

	return app, dynamicClient, clusterID
}

func TestValidateResourceCreationSuccess(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	req := ResourceCreationRequest{
		YAML: `apiVersion: apps/v1
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
      - name: test
        image: nginx:latest`,
	}

	resp, err := app.ValidateResourceCreation(clusterID, req)
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
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test -run TestValidateResourceCreationSuccess -v ./...`
Expected: Compilation error — `ResourceCreationRequest` and `ValidateResourceCreation` not defined.

**Step 3: Write minimal implementation**

Create `backend/object_yaml_creation.go`:

```go
package backend

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

// ResourceCreationRequest captures the YAML and optional namespace override
// for creating a new Kubernetes resource.
type ResourceCreationRequest struct {
	YAML      string `json:"yaml"`
	Namespace string `json:"namespace"` // optional; overrides YAML metadata.namespace for namespaced resources
}

// ResourceCreationResponse returns metadata about the newly created resource.
type ResourceCreationResponse struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	Kind            string `json:"kind"`
	APIVersion      string `json:"apiVersion"`
	ResourceVersion string `json:"resourceVersion"`
}

// ValidateResourceCreation performs a server-side dry-run create to check
// whether the YAML would produce a valid resource.
func (a *App) ValidateResourceCreation(clusterID string, req ResourceCreationRequest) (*ResourceCreationResponse, error) {
	mc, err := a.prepareCreationContext(clusterID, req)
	if err != nil {
		return nil, err
	}

	ctx, cancel := a.mutationContext()
	defer cancel()

	result, err := mc.resource.Create(
		ctx,
		mc.obj,
		metav1.CreateOptions{DryRun: []string{metav1.DryRunAll}},
	)
	if err != nil {
		return nil, wrapKubernetesError(err, "validation failed")
	}

	return &ResourceCreationResponse{
		Name:            result.GetName(),
		Namespace:       result.GetNamespace(),
		Kind:            result.GetKind(),
		APIVersion:      result.GetAPIVersion(),
		ResourceVersion: result.GetResourceVersion(),
	}, nil
}

// CreateResource creates a new Kubernetes resource from the provided YAML.
func (a *App) CreateResource(clusterID string, req ResourceCreationRequest) (*ResourceCreationResponse, error) {
	mc, err := a.prepareCreationContext(clusterID, req)
	if err != nil {
		return nil, err
	}

	ctx, cancel := a.mutationContext()
	defer cancel()

	result, err := mc.resource.Create(
		ctx,
		mc.obj,
		metav1.CreateOptions{},
	)
	if err != nil {
		return nil, wrapKubernetesError(err, "create failed")
	}

	deps, _, _ := a.resolveClusterDependencies(clusterID)
	if deps.Logger != nil {
		deps.Logger.Info(fmt.Sprintf("Created %s/%s in namespace %q", result.GetKind(), result.GetName(), result.GetNamespace()), "ResourceCreation")
	}

	return &ResourceCreationResponse{
		Name:            result.GetName(),
		Namespace:       result.GetNamespace(),
		Kind:            result.GetKind(),
		APIVersion:      result.GetAPIVersion(),
		ResourceVersion: result.GetResourceVersion(),
	}, nil
}

// creationContext holds resolved state for a create operation.
type creationContext struct {
	obj      *unstructured.Unstructured
	resource dynamic.ResourceInterface
	gvr      schema.GroupVersionResource
}

// prepareCreationContext parses YAML, resolves the GVR, applies namespace
// override, and returns a ready-to-use creation context.
func (a *App) prepareCreationContext(clusterID string, req ResourceCreationRequest) (*creationContext, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}

	if deps.KubernetesClient == nil || deps.DynamicClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	trimmedYAML := strings.TrimSpace(req.YAML)
	if trimmedYAML == "" {
		return nil, fmt.Errorf("YAML content is required")
	}

	obj, err := parseYAMLToUnstructured(trimmedYAML)
	if err != nil {
		return nil, err
	}

	if obj.GetKind() == "" || obj.GetAPIVersion() == "" {
		return nil, fmt.Errorf("apiVersion and kind are required")
	}

	if obj.GetName() == "" {
		return nil, fmt.Errorf("metadata.name is required")
	}

	if obj.GetKind() == "List" {
		return nil, fmt.Errorf("list objects are not supported; create one resource at a time")
	}

	// Strip fields that should not be set on new resources
	obj.SetResourceVersion("")
	obj.SetUID("")
	obj.SetCreationTimestamp(metav1.Time{})
	unstructured.RemoveNestedField(obj.Object, "metadata", "managedFields")
	unstructured.RemoveNestedField(obj.Object, "metadata", "selfLink")
	unstructured.RemoveNestedField(obj.Object, "status")

	gvk := schema.FromAPIVersionAndKind(obj.GetAPIVersion(), obj.GetKind())

	ctx, cancel := a.mutationContext()
	defer cancel()

	// Strict GVR resolution for creation — no kind-only fallback.
	// Unlike editing (which uses getGVRForGVKWithDependencies with its
	// getGVRForDependencies fallback), creation must fail hard on ambiguity
	// to prevent cross-group collisions (e.g., same Kind in different API groups).
	gvr, isNamespaced, err := resolveGVRStrict(ctx, deps, gvk)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve resource mapping for %s: %w", gvk.String(), err)
	}

	// Apply namespace override for namespaced resources
	if isNamespaced {
		if req.Namespace != "" {
			obj.SetNamespace(req.Namespace)
		}
		if obj.GetNamespace() == "" {
			return nil, fmt.Errorf("namespaced resources require a namespace; set metadata.namespace or provide a namespace override")
		}
	} else {
		obj.SetNamespace("")
	}

	var resource dynamic.ResourceInterface
	if isNamespaced {
		resource = deps.DynamicClient.Resource(gvr).Namespace(obj.GetNamespace())
	} else {
		resource = deps.DynamicClient.Resource(gvr)
	}

	return &creationContext{
		obj:      obj,
		resource: resource,
		gvr:      gvr,
	}, nil
}

// resolveGVRStrict performs strict GVK→GVR resolution using API discovery
// and CRD lookup. Unlike getGVRForGVKWithDependencies, this does NOT fall
// back to kind-only matching via getGVRForDependencies. If the exact
// group/version/kind cannot be resolved, it returns an error.
func resolveGVRStrict(
	ctx context.Context,
	deps common.Dependencies,
	gvk schema.GroupVersionKind,
) (schema.GroupVersionResource, bool, error) {
	if deps.KubernetesClient == nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("kubernetes client not initialized")
	}

	// Use a timeout-safe discovery client (same pattern as object_yaml_mutation.go)
	discoveryClient := deps.KubernetesClient.Discovery()
	if deps.RestConfig != nil {
		timeout := mutationRequestTimeout
		if deadline, ok := ctx.Deadline(); ok {
			if remaining := time.Until(deadline); remaining > 0 && remaining < timeout {
				timeout = remaining
			}
		}
		cfg := rest.CopyConfig(deps.RestConfig)
		cfg.Timeout = timeout
		if dc, err := discovery.NewDiscoveryClientForConfig(cfg); err == nil {
			discoveryClient = dc
		} else if deps.Logger != nil {
			deps.Logger.Debug(fmt.Sprintf("Discovery client fallback for resource creation: %v", err), "ResourceCreation")
		}
	}

	apiResourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && deps.Logger != nil {
		deps.Logger.Debug(fmt.Sprintf("ServerPreferredResources returned error: %v", err), "ResourceCreation")
	}

	for _, apiResourceList := range apiResourceLists {
		gv, parseErr := schema.ParseGroupVersion(apiResourceList.GroupVersion)
		if parseErr != nil {
			continue
		}
		if gv.Group != gvk.Group || gv.Version != gvk.Version {
			continue
		}
		for _, apiResource := range apiResourceList.APIResources {
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			if strings.EqualFold(apiResource.Kind, gvk.Kind) {
				return schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: apiResource.Name,
				}, apiResource.Namespaced, nil
			}
		}
	}

	// Check CRDs as secondary lookup
	if deps.APIExtensionsClient != nil {
		crds, listErr := deps.APIExtensionsClient.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
		if listErr == nil {
			for _, crd := range crds.Items {
				if !strings.EqualFold(crd.Spec.Names.Kind, gvk.Kind) || crd.Spec.Group != gvk.Group {
					continue
				}
				for _, version := range crd.Spec.Versions {
					if version.Name == gvk.Version {
						return schema.GroupVersionResource{
							Group:    crd.Spec.Group,
							Version:  version.Name,
							Resource: crd.Spec.Names.Plural,
						}, crd.Spec.Scope == apiextensionsv1.NamespaceScoped, nil
					}
				}
			}
		}
	}

	return schema.GroupVersionResource{}, false, fmt.Errorf(
		"unable to resolve resource for %s; ensure apiVersion and kind are correct", gvk.String(),
	)
}
```

**Step 4: Run test to verify it passes**

Run: `cd backend && go test -run TestValidateResourceCreationSuccess -v ./...`
Expected: PASS

**Step 5: Commit**

```
feat: add backend resource creation with dry-run validation
```

---

## Task 2: Backend — Additional Creation Tests ✅

**Files:**
- Modify: `backend/object_yaml_creation_test.go`

**Step 1: Add tests for error cases and CreateResource**

Add these test functions to `object_yaml_creation_test.go`:

```go
func TestCreateResourceSuccess(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	req := ResourceCreationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: new-deploy
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: new
  template:
    metadata:
      labels:
        app: new
    spec:
      containers:
      - name: app
        image: nginx:latest`,
	}

	resp, err := app.CreateResource(clusterID, req)
	if err != nil {
		t.Fatalf("CreateResource returned error: %v", err)
	}
	if resp.Name != "new-deploy" {
		t.Fatalf("expected name new-deploy, got %s", resp.Name)
	}
	if resp.Namespace != "default" {
		t.Fatalf("expected namespace default, got %s", resp.Namespace)
	}
}

func TestCreateResourceNamespaceOverride(t *testing.T) {
	app, _, clusterID := setupCreationTestApp(t)

	req := ResourceCreationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: overridden-ns
  namespace: original
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

	req := ResourceCreationRequest{
		YAML: `apiVersion: v1
kind: ConfigMap
metadata:
  name: test
  namespace: default`,
	}

	_, err := app.CreateResource("nonexistent:cluster", req)
	if err == nil {
		t.Fatal("expected error for invalid cluster")
	}
}

func TestCreateResourceStripsServerFields(t *testing.T) {
	// Verify that resourceVersion, UID, managedFields are stripped before creation
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

	// Reactor returns AlreadyExists error
	dynamicClient.Fake.PrependReactor("create", "deployments", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewAlreadyExists(
			schema.GroupResource{Group: "apps", Resource: "deployments"},
			"existing-deploy",
		)
	})

	req := ResourceCreationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: existing-deploy
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
        image: nginx:latest`,
	}

	_, err := app.CreateResource(clusterID, req)
	if err == nil {
		t.Fatal("expected AlreadyExists error")
	}
	// Verify it's wrapped as a structured objectYAMLError
	errStr := err.Error()
	if !strings.Contains(errStr, "AlreadyExists") {
		t.Fatalf("expected AlreadyExists in error, got: %s", errStr)
	}
}

func TestCreateResourceForbidden(t *testing.T) {
	app, dynamicClient, clusterID := setupCreationTestApp(t)

	// Reactor returns Forbidden error
	dynamicClient.Fake.PrependReactor("create", "deployments", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Group: "apps", Resource: "deployments"},
			"forbidden-deploy",
			fmt.Errorf("user cannot create deployments in namespace default"),
		)
	})

	req := ResourceCreationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: forbidden-deploy
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
        image: nginx:latest`,
	}

	_, err := app.CreateResource(clusterID, req)
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

	// Reactor returns Invalid error with field-level causes
	dynamicClient.Fake.PrependReactor("create", "deployments", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewInvalid(
			schema.GroupKind{Group: "apps", Kind: "Deployment"},
			"invalid-deploy",
			field.ErrorList{
				field.Required(field.NewPath("spec", "selector"), "selector is required"),
			},
		)
	})

	req := ResourceCreationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: invalid-deploy
  namespace: default
spec:
  replicas: 1
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
	if err == nil {
		t.Fatal("expected Invalid error")
	}
	errStr := err.Error()
	if !strings.Contains(errStr, "Invalid") {
		t.Fatalf("expected Invalid in error, got: %s", errStr)
	}
	// Verify structured causes are present
	if !strings.Contains(errStr, "causes") {
		t.Fatalf("expected field-level causes in error, got: %s", errStr)
	}
}

func TestValidateResourceCreationDoesNotPersist(t *testing.T) {
	app, dynamicClient, clusterID := setupCreationTestApp(t)

	createCount := 0
	dynamicClient.Fake.PrependReactor("create", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		if len(createAction.GetOptions().DryRun) == 0 {
			createCount++
		}
		return false, createAction.GetObject().DeepCopyObject(), nil
	})

	req := ResourceCreationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: dry-run-only
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
        image: nginx:latest`,
	}

	_, err := app.ValidateResourceCreation(clusterID, req)
	if err != nil {
		t.Fatalf("ValidateResourceCreation returned error: %v", err)
	}
	if createCount > 0 {
		t.Fatal("ValidateResourceCreation should not persist; non-dry-run create was called")
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

	client := clientfake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	// Register two groups with the same Kind "Widget" but different groups.
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

	// Request creation with stable.example.com/v1 — must resolve to stable, not unstable
	req := ResourceCreationRequest{
		YAML: `apiVersion: stable.example.com/v1
kind: Widget
metadata:
  name: my-widget
  namespace: default
spec:
  color: blue`,
	}

	var capturedResource string
	dynamicClient.Fake.PrependReactor("create", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		capturedResource = action.GetResource().Resource
		createAction := action.(cgotesting.CreateAction)
		return false, createAction.GetObject().DeepCopyObject(), nil
	})

	_, err := app.CreateResource(clusterID, req)
	if err != nil {
		t.Fatalf("CreateResource returned error: %v", err)
	}
	if capturedResource != "widgets" {
		t.Fatalf("expected resource 'widgets', got %q", capturedResource)
	}

	// Now request with a non-existent group — must FAIL, not fall back to kind-only match
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
```

**Step 2: Run all tests**

Run: `cd backend && go test -run "TestValidateResourceCreation|TestCreateResource" -v ./...`
Expected: All PASS

**Step 3: Commit**

```
test: add comprehensive tests for resource creation backend
```

---

## Task 3: Backend — Resource Templates ✅

**Files:**
- Create: `backend/resources/templates/templates.go`
- Modify: `backend/app.go` (add `GetResourceTemplates` method)

**Step 1: Write the test**

Create `backend/resources/templates/templates_test.go`:

```go
package templates

import (
	"testing"

	"sigs.k8s.io/yaml"
)

func TestAllTemplatesAreValidYAML(t *testing.T) {
	templates := GetAll()
	if len(templates) == 0 {
		t.Fatal("expected at least one template")
	}

	for _, tmpl := range templates {
		t.Run(tmpl.Name, func(t *testing.T) {
			if tmpl.Name == "" {
				t.Fatal("template name is empty")
			}
			if tmpl.Kind == "" {
				t.Fatal("template kind is empty")
			}
			if tmpl.APIVersion == "" {
				t.Fatal("template apiVersion is empty")
			}
			if tmpl.Category == "" {
				t.Fatal("template category is empty")
			}
			if tmpl.YAML == "" {
				t.Fatal("template YAML is empty")
			}

			// Verify the YAML is parseable
			var parsed map[string]interface{}
			if err := yaml.Unmarshal([]byte(tmpl.YAML), &parsed); err != nil {
				t.Fatalf("template YAML is invalid: %v", err)
			}

			// Verify apiVersion and kind in the YAML match the struct fields
			if apiVersion, ok := parsed["apiVersion"].(string); !ok || apiVersion != tmpl.APIVersion {
				t.Fatalf("YAML apiVersion %q does not match struct field %q", apiVersion, tmpl.APIVersion)
			}
			if kind, ok := parsed["kind"].(string); !ok || kind != tmpl.Kind {
				t.Fatalf("YAML kind %q does not match struct field %q", kind, tmpl.Kind)
			}
		})
	}
}

func TestTemplateCategoriesAreValid(t *testing.T) {
	validCategories := map[string]bool{
		"Workloads":  true,
		"Networking": true,
		"Config":     true,
	}

	for _, tmpl := range GetAll() {
		if !validCategories[tmpl.Category] {
			t.Errorf("template %q has invalid category %q", tmpl.Name, tmpl.Category)
		}
	}
}

func TestTemplateNamesAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, tmpl := range GetAll() {
		if seen[tmpl.Name] {
			t.Errorf("duplicate template name: %s", tmpl.Name)
		}
		seen[tmpl.Name] = true
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test ./resources/templates/ -v`
Expected: Compilation error — package doesn't exist yet.

**Step 3: Write the templates**

Create `backend/resources/templates/templates.go` with the `ResourceTemplate` struct, `GetAll()` function, and curated templates for: Deployment, Service, ConfigMap, Secret, Job, CronJob, Ingress.

Each template should:
- Have inline YAML comments explaining key fields
- Use placeholder values like `my-app`, `my-namespace`
- Include only required fields plus the most commonly set optional fields
- Be a valid, minimal, working resource definition

```go
package templates

// ResourceTemplate defines a curated starter template for resource creation.
type ResourceTemplate struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	APIVersion  string `json:"apiVersion"`
	Category    string `json:"category"`
	Description string `json:"description"`
	YAML        string `json:"yaml"`
}

// GetAll returns all available resource creation templates.
// To add a new template, append to this slice.
func GetAll() []ResourceTemplate {
	return []ResourceTemplate{
		deploymentTemplate(),
		serviceTemplate(),
		configMapTemplate(),
		secretTemplate(),
		jobTemplate(),
		cronJobTemplate(),
		ingressTemplate(),
	}
}
```

Then define each template function (e.g., `deploymentTemplate()`) returning a `ResourceTemplate` with the embedded YAML string. Keep each template in the same file for simplicity — they're just data.

**Step 4: Add `GetResourceTemplates` to App**

In `backend/app.go`, add:

```go
import "github.com/luxury-yacht/app/backend/resources/templates"

// GetResourceTemplates returns all available starter templates for resource creation.
// This method does not require a cluster connection.
func (a *App) GetResourceTemplates() []templates.ResourceTemplate {
	return templates.GetAll()
}
```

**Step 5: Run tests**

Run: `cd backend && go test ./resources/templates/ -v`
Expected: All PASS

**Step 6: Commit**

```
feat: add curated resource creation templates
```

---

## Task 4: Frontend — Modal State and Keyboard Priorities ✅

**Files:**
- Modify: `frontend/src/core/contexts/ModalStateContext.tsx`
- Modify: `frontend/src/ui/shortcuts/priorities.ts`

**Step 1: Add `isCreateResourceOpen` to ModalStateContext**

In `frontend/src/core/contexts/ModalStateContext.tsx`:

- Add `isCreateResourceOpen: boolean` and `setIsCreateResourceOpen: (open: boolean) => void` to the `ModalStateContextType` interface
- Add `const [isCreateResourceOpen, setIsCreateResourceOpen] = useState(false);` in the provider
- Add both to the `useMemo` value object and its dependency array

**Step 2: Add keyboard priority constants**

In `frontend/src/ui/shortcuts/priorities.ts`:

- Add `CREATE_RESOURCE_MODAL: 92` to `KeyboardScopePriority` (between CONFIRMATION_MODAL:95 and GRIDTABLE_BODY:90)
- Add `CREATE_RESOURCE_MODAL: 930` to `KeyboardContextPriority` (between CONFIRMATION_MODAL:950 and OBJECT_DIFF_MODAL:920)

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```
feat: add create resource modal state and keyboard priorities
```

---

## Task 5: Frontend — Command Palette Entry ✅

**Files:**
- Modify: `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`
- Modify: `frontend/src/ui/command-palette/CommandPaletteCommands.test.tsx` (if it exists, add test for new command)

**Step 1: Add the create-resource command**

In `CommandPaletteCommands.tsx`, add to the commands array (in the "Application" section, after the `toggle-diagnostics` command):

```typescript
{
  id: 'create-resource',
  label: 'Create Resource',
  description: 'Create a new Kubernetes resource from YAML',
  category: 'Application',
  action: () => {
    viewState.setIsCreateResourceOpen(true);
  },
  keywords: ['create', 'new', 'resource', 'yaml', 'apply', 'deploy'],
},
```

Note: `viewState` already provides `setIsCreateResourceOpen` because it exposes the modal state context. Verify this by checking how `setIsAboutOpen` and `setIsSettingsOpen` are accessed — they come from `useViewState()` which composes the modal state.

**Step 2: Verify TypeScript compiles and tests pass**

Run: `cd frontend && npx tsc --noEmit && npx vitest run --reporter=verbose src/ui/command-palette/`
Expected: No TS errors, existing tests pass

**Step 3: Commit**

```
feat: add Create Resource command to command palette
```

---

## Task 6: Frontend — CreateResourceModal Shell ✅

**Files:**
- Create: `frontend/src/ui/modals/CreateResourceModal.tsx`
- Create: `frontend/src/ui/modals/CreateResourceModal.css`
- Modify: `frontend/src/ui/layout/AppLayout.tsx`

**Step 1: Create the modal component shell**

Follow the exact pattern from `AboutModal.tsx` and `SettingsModal.tsx`:
- `React.memo` wrapper
- Open/close animation with `shouldRender` + `isClosing` state
- `useKeyboardContext` for push/pop
- `useShortcut` for Escape key
- `useModalFocusTrap` for accessibility
- Props: `isOpen: boolean`, `onClose: () => void`
- Default export (required for `withLazyBoundary`)

Initial content: header with title "Create Resource" and close button, empty body with placeholder text "YAML editor will go here", footer with Cancel and Create buttons (Create disabled for now).

**Step 2: Create the CSS file**

In `CreateResourceModal.css`:
- `.create-resource-modal` sets `max-width: 900px` and `height: 80vh` (needs room for the YAML editor)
- Use CSS variables from the theme (`--color-bg`, `--color-text`, `--color-border`, etc.)
- Reference `modals.css` base classes (`.modal-overlay`, `.modal-container`, `.modal-header`, etc.)

**Step 3: Wire into AppLayout**

In `AppLayout.tsx`:
- Add lazy import: `const CreateResourceModal = withLazyBoundary(() => import('@ui/modals/CreateResourceModal'), 'Loading create resource...');`
- Add render block (after ObjectDiffModal, before ErrorNotificationSystem):

```tsx
<PanelErrorBoundary
  onClose={() => viewState.setIsCreateResourceOpen(false)}
  panelName="create-resource"
>
  <CreateResourceModal
    isOpen={viewState.isCreateResourceOpen}
    onClose={() => viewState.setIsCreateResourceOpen(false)}
  />
</PanelErrorBoundary>
```

**Step 4: Verify it compiles and renders**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```
feat: add CreateResourceModal shell with AppLayout wiring
```

---

## Task 7: Frontend — Template Picker and YAML Editor ✅

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`
- Modify: `frontend/src/ui/modals/CreateResourceModal.css`

**Step 1: Add template loading and picker**

- Import `GetResourceTemplates` from `@wailsjs/go/backend/App`
- On modal open, call `GetResourceTemplates()` and store in state
- Render a `<select>` dropdown grouped by category with `<optgroup>` elements
- First option is "Blank" which loads a minimal YAML skeleton:

```yaml
apiVersion:
kind:
metadata:
  name:
  namespace:
```

- When a template is selected, replace the editor content with the template YAML, substituting the namespace placeholder with the currently selected namespace

**Step 2: Add the CodeMirror YAML editor**

- Import `CodeMirror` from `@uiw/react-codemirror` and `yaml` lang from `@codemirror/lang-yaml`
- Import `useCodeMirrorTheme` (or the theme hook used by `YamlTab.tsx` — check the exact import)
- Add the editor in the modal body, taking up available vertical space
- Store editor content in state: `const [yamlContent, setYamlContent] = useState('')`
- Add `EditorView.lineWrapping` extension

**Step 3: Add namespace context bar**

- Import `useNamespace` and `useKubeconfig` to get the current cluster name and namespace
- Import `isAllNamespaces` from `@modules/namespace/constants`
- Above the editor, render a context bar showing:
  - Cluster name (read-only display)
  - Namespace dropdown populated from `namespace.namespaces` **filtered to exclude synthetic entries** (`ns.isSynthetic !== true`). Default to `namespace.selectedNamespace` ONLY if it is not a synthetic value (check with `isAllNamespaces()`). If the current selection is synthetic (e.g., "All Namespaces"), default to empty/no selection — the user must pick a real namespace.
- Store selected namespace in local state

**Step 4: Add client-side YAML parsing and scope detection**

- As `yamlContent` changes, parse it with `YAML.parseDocument()` (from `yaml` library) to extract `kind` and `apiVersion`
- If parsing fails, show a parse error message below the editor
- **Scope detection (catalog-backed):** Look up the parsed `kind` against the catalog's known resource types (the catalog data is already loaded in the frontend via the refresh system). If the kind is found and is cluster-scoped, hide the namespace selector. If the kind is found and is namespaced, show it. If the kind is NOT found in the catalog (e.g., the user is typing a CRD kind not yet cataloged, or an unrecognized kind), show the namespace selector as a safe default and let the server validate scope.

**Step 5: Style the new elements**

Update `CreateResourceModal.css` with styles for:
- `.create-resource-context-bar` — flex row with cluster label and namespace dropdown
- `.create-resource-template-picker` — styled select dropdown
- `.create-resource-editor` — flex: 1 container for CodeMirror
- `.create-resource-parse-error` — error message styling using `--color-error`

**Step 6: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```
feat: add template picker and YAML editor to CreateResourceModal
```

---

## Task 8: Frontend — Validation and Creation Flow ✅

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`
- Modify: `frontend/src/ui/modals/CreateResourceModal.css`

**Step 1: Add Wails binding imports**

Import `ValidateResourceCreation` and `CreateResource` from `@wailsjs/go/backend/App`. These will be auto-generated after the Wails build step — if they don't exist yet, add temporary type stubs or run `wails generate module`.

**Step 2: Implement the Validate button**

- Add state: `validationResult` (success message or null), `validationError` (structured error or null), `isValidating` (loading state)
- On click: call `ValidateResourceCreation(clusterId, { yaml: yamlContent, namespace: selectedNamespace })`
- On success: show green success banner with "Validation passed" and the resource kind/name
- On error: parse the error using the same `objectYAMLError` pattern from YamlTab. Display structured field-level causes inline below the editor.
- Disable the button while validating (show spinner or "Validating..." text)

**Step 3: Implement the Create button**

- Add state: `isCreating` (loading state)
- **Multi-cluster safety:** Before the async call, capture `clusterId` and `clusterName` from the current kubeconfig context into local variables. All post-create actions use these captured values, NOT the current UI context (the user may switch clusters while the request is in flight).
- On click: call `CreateResource(capturedClusterId, { yaml: yamlContent, namespace: selectedNamespace })`
- **Deterministic success sequence:**
  1. Open the new object in the Object Panel via `openWithObject()` with explicit `clusterId: capturedClusterId` and `clusterName: capturedClusterName` from the response metadata — never rely on ambient UI state
  2. Close the modal
  3. Trigger `refreshOrchestrator.triggerManualRefreshForContext()` with no arguments — refresh whatever the user is currently viewing. The safety-critical multi-cluster pinning is in `openWithObject` (step 1) and the notification (step 4). The refresh is a UX convenience that should always target the current view, not the creation target.
  4. Show success via the error context's INFO severity: "Created {Kind}/{name} in namespace {namespace} on cluster {clusterName}"
- On error: display structured error same as validation errors
- Disable the button while creating

**Step 4: Add "no cluster" guard**

- If `selectedClusterId` is falsy, render a message "No cluster connected. Connect to a cluster to create resources." instead of the editor
- Disable Validate and Create buttons

**Step 5: Validation soft gate policy**

- Create button is always enabled (not gated on validation success). Both Validate and Create are independent actions. Create performs its own server-side validation during the actual create call. Validate is an optional confidence check for the user.
- Disable both buttons only while their respective async operations are in flight (loading states)

**Step 6: Style validation states**

Update CSS:
- `.create-resource-validation-success` — green border/background using `--color-success`
- `.create-resource-validation-error` — red border using `--color-error`, `--color-error-bg`
- `.create-resource-error-causes` — list of field-level causes
- `.create-resource-actions` — footer button layout with spacing

**Step 7: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```
feat: add validation and creation flow to CreateResourceModal
```

---

## Task 9: Frontend — CreateResourceModal Tests ✅

**Files:**
- Create: `frontend/src/ui/modals/CreateResourceModal.test.tsx`

**Step 1: Write tests**

Follow the pattern from `AboutModal.test.tsx` — use Vitest, ReactDOM, `vi.mock()` for dependencies:

```typescript
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
vi.mock('@wailsjs/go/backend/App', () => ({
  GetResourceTemplates: vi.fn().mockResolvedValue([
    {
      name: 'Deployment',
      kind: 'Deployment',
      apiVersion: 'apps/v1',
      category: 'Workloads',
      description: 'A Deployment',
      yaml: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n  namespace: default',
    },
  ]),
  ValidateResourceCreation: vi.fn().mockResolvedValue({
    name: 'my-app',
    namespace: 'default',
    kind: 'Deployment',
    apiVersion: 'apps/v1',
    resourceVersion: '1',
  }),
  CreateResource: vi.fn().mockResolvedValue({
    name: 'my-app',
    namespace: 'default',
    kind: 'Deployment',
    apiVersion: 'apps/v1',
    resourceVersion: '1',
  }),
}));

// Mock other dependencies (shortcuts, contexts, etc.) following AboutModal.test.tsx patterns
```

Test cases:
- Does not render when `isOpen` is false
- Renders modal header and buttons when `isOpen` is true
- Loads templates on open
- Template selection populates the editor
- Calls `onClose` when Cancel is clicked
- Calls `ValidateResourceCreation` with correct clusterId when Validate is clicked
- Calls `CreateResource` with correct clusterId when Create is clicked
- Create button is always enabled (not gated on validation)
- Shows validation error on dry-run failure
- Shows AlreadyExists error with resource name when create fails with 409
- Shows Forbidden error with permission message when create fails with 403
- Shows Invalid error with field-level causes when create fails with 422
- On success: calls `openWithObject` with explicit clusterId/clusterName from captured context (not ambient UI state)
- On success: calls `onClose` after opening object panel
- Namespace dropdown excludes synthetic "All Namespaces" entry
- Defaults to empty namespace selection when current selection is "All Namespaces"

**Step 2: Run tests**

Run: `cd frontend && npx vitest run --reporter=verbose src/ui/modals/CreateResourceModal.test.tsx`
Expected: All PASS

**Step 3: Commit**

```
test: add CreateResourceModal component tests
```

---

## Task 10: Build Verification and Wails Binding Generation ✅

**Step 1: Generate Wails bindings**

The new Go methods (`ValidateResourceCreation`, `CreateResource`, `GetResourceTemplates`) need Wails to regenerate the TypeScript bindings.

Run: `wails generate module`

This updates:
- `frontend/wailsjs/go/backend/App.js`
- `frontend/wailsjs/go/backend/App.d.ts`
- `frontend/wailsjs/go/models.ts` (for the new request/response types)

**Step 2: Run full backend tests**

Run: `cd backend && go test ./... -v`
Expected: All PASS

**Step 3: Run full frontend checks**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: No TS errors, all tests pass

**Step 4: Run linting**

Run whatever lint commands the project uses (check `package.json` scripts and `mage` targets).

**Step 5: Commit**

```
chore: regenerate Wails bindings for resource creation
```

---

## Task 11: Update Documentation ✅

**Files:**
- Modify: `docs/plans/todos.md` (mark resource creation as ✅)

**Step 1: Update todos**

Change the resource creation entry in `docs/plans/todos.md`:

```markdown
- ✅ Resource creation
  - starter templates for common resource types
  - reuse the existing code editor
```

**Step 2: Commit**

```
docs: mark resource creation as complete in todos
```
