package backend

import (
	"context"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
)

func resetGVRCache() {
	clearGVRCache()
}

const testClusterID = "config:ctx"

// registerTestClusterWithClients sets up cluster clients with the provided clients.
// All Kubernetes clients are now per-cluster - there are no global client fields.
func registerTestClusterWithClients(app *App, clusterID string, cc *clusterClients) {
	app.clusterClients = map[string]*clusterClients{clusterID: cc}
}

func TestGetObjectYAMLAggregatesEndpointSlices(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	fakeClient := kubernetesfake.NewClientset()
	registerTestClusterWithClients(app, testClusterID, &clusterClients{
		meta:              ClusterMeta{ID: testClusterID, Name: "ctx"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            fakeClient,
	})

	port := int32(80)
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "svc-abc",
			Namespace: "demo",
			Labels:    map[string]string{discoveryv1.LabelServiceName: "svc"},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.0.0.1"},
		}},
		Ports: []discoveryv1.EndpointPort{{
			Port: &port,
		}},
	}
	_, err := fakeClient.DiscoveryV1().EndpointSlices("demo").Create(context.Background(), slice, metav1.CreateOptions{})
	if err != nil {
		t.Fatalf("failed to seed endpoint slice: %v", err)
	}

	yamlStr, err := app.GetObjectYAML(testClusterID, "endpointslice", "demo", "svc")
	if err != nil {
		t.Fatalf("GetObjectYAML returned error: %v", err)
	}
	if !strings.Contains(yamlStr, "EndpointSliceList") || !strings.Contains(yamlStr, "svc-abc") {
		t.Fatalf("unexpected YAML output:\n%s", yamlStr)
	}
}

func TestGetObjectYAMLNamespacedResource(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// Scope the GVR cache to the test cluster selection.
	cacheKey := gvrCacheKey(testClusterID, "Pod")
	gvrCacheMutex.Lock()
	gvrCache[cacheKey] = gvrCacheEntry{
		gvr:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		namespaced: true,
		cachedAt:   time.Now(),
	}
	gvrCacheMutex.Unlock()

	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to add corev1 to scheme: %v", err)
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-pod",
			Namespace: "demo",
		},
	}
	fakeClient := kubernetesfake.NewClientset()
	dynamicClient := dynamicfake.NewSimpleDynamicClient(scheme, pod)
	registerTestClusterWithClients(app, testClusterID, &clusterClients{
		meta:              ClusterMeta{ID: testClusterID, Name: "ctx"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            fakeClient,
		dynamicClient:     dynamicClient,
	})

	yamlStr, err := app.GetObjectYAML(testClusterID, "Pod", "demo", "demo-pod")
	if err != nil {
		t.Fatalf("GetObjectYAML returned error: %v", err)
	}
	if !strings.Contains(yamlStr, "name: demo-pod") || !strings.Contains(yamlStr, "namespace: demo") {
		t.Fatalf("unexpected YAML output:\n%s", yamlStr)
	}
}

func TestGetObjectYAMLUsesCacheWhenAvailable(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.responseCache = newResponseCache(time.Minute, 10)
	registerTestClusterWithClients(app, testClusterID, &clusterClients{
		meta:              ClusterMeta{ID: testClusterID, Name: "ctx"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            kubernetesfake.NewClientset(),
	})

	cacheKey := objectYAMLCacheKey("Pod", "default", "cached-pod")
	app.responseCacheStore(testClusterID, cacheKey, "cached-yaml")

	yamlStr, err := app.GetObjectYAML(testClusterID, "Pod", "default", "cached-pod")
	if err != nil {
		t.Fatalf("GetObjectYAML returned error: %v", err)
	}
	if yamlStr != "cached-yaml" {
		t.Fatalf("expected cached YAML, got %q", yamlStr)
	}
}

func TestLoadGVRCachedEvictsExpiredEntry(t *testing.T) {
	resetGVRCache()
	cacheKey := gvrCacheKey("cluster-a", "Widget")
	expired := time.Now().Add(-gvrCacheTTL - time.Second)

	gvrCacheMutex.Lock()
	gvrCache[cacheKey] = gvrCacheEntry{
		gvr:        schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
		namespaced: true,
		cachedAt:   expired,
	}
	gvrCacheMutex.Unlock()

	if _, found := loadGVRCached(cacheKey); found {
		t.Fatal("expected expired GVR cache entry to be evicted")
	}

	gvrCacheMutex.RLock()
	_, exists := gvrCache[cacheKey]
	gvrCacheMutex.RUnlock()
	if exists {
		t.Fatal("expected expired GVR cache entry to be removed")
	}
}

func TestGetObjectYAMLClusterScopedResource(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	// Scope the GVR cache to the test cluster selection.
	cacheKey := gvrCacheKey(testClusterID, "node")
	gvrCacheMutex.Lock()
	gvrCache[cacheKey] = gvrCacheEntry{
		gvr:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"},
		namespaced: false,
		cachedAt:   time.Now(),
	}
	gvrCacheMutex.Unlock()

	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to add corev1 to scheme: %v", err)
	}
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: "node-1",
		},
	}
	fakeClient := kubernetesfake.NewClientset()
	dynamicClient := dynamicfake.NewSimpleDynamicClient(scheme, node)
	registerTestClusterWithClients(app, testClusterID, &clusterClients{
		meta:              ClusterMeta{ID: testClusterID, Name: "ctx"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            fakeClient,
		dynamicClient:     dynamicClient,
	})

	yamlStr, err := app.GetObjectYAML(testClusterID, "node", "", "node-1")
	if err != nil {
		t.Fatalf("GetObjectYAML returned error: %v", err)
	}
	if !strings.Contains(yamlStr, "name: node-1") || strings.Contains(yamlStr, "namespace:") {
		t.Fatalf("unexpected YAML output for cluster resource:\n%s", yamlStr)
	}
}

func TestGetObjectYAMLRequiresDynamicClient(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	fakeClient := kubernetesfake.NewClientset()
	// Register cluster WITHOUT dynamicClient to test the error path.
	registerTestClusterWithClients(app, testClusterID, &clusterClients{
		meta:              ClusterMeta{ID: testClusterID, Name: "ctx"},
		kubeconfigPath:    "/path",
		kubeconfigContext: "ctx",
		client:            fakeClient,
		// dynamicClient is intentionally nil
	})

	// Pre-seed the GVR cache so the test hits the dynamic client check.
	gvrCacheMutex.Lock()
	gvrCache[gvrCacheKey(testClusterID, "pod")] = gvrCacheEntry{
		gvr:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		namespaced: true,
		cachedAt:   time.Now(),
	}
	gvrCacheMutex.Unlock()

	_, err := app.GetObjectYAML(testClusterID, "pod", "demo", "missing")
	if err == nil || !strings.Contains(err.Error(), "dynamic client not initialized") {
		t.Fatalf("expected dynamic client error, got %v", err)
	}
}

func TestGetGVRFallsBackToCRD(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "widgets",
				Kind:   "Widget",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	}
	fakeClient := kubernetesfake.NewClientset()
	apiExtClient := apiextensionsfake.NewClientset(crd)
	registerTestClusterWithClients(app, testClusterID, &clusterClients{
		meta:                ClusterMeta{ID: testClusterID, Name: "ctx"},
		kubeconfigPath:      "/path",
		kubeconfigContext:   "ctx",
		client:              fakeClient,
		apiextensionsClient: apiExtClient,
	})

	gvr, namespaced, err := app.getGVR(testClusterID, "Widget")
	if err != nil {
		t.Fatalf("getGVR error: %v", err)
	}
	if !namespaced || gvr.Resource != "widgets" || gvr.Group != "example.com" {
		t.Fatalf("unexpected gvr %+v namespaced=%v", gvr, namespaced)
	}
}

// TestListEndpointSlicesRequiresClient was testing the deprecated listEndpointSlicesForService.
// The method was removed as part of deleting global client fields.
// The production code now uses listEndpointSlicesForServiceWithDependencies which
// receives the client via explicit dependencies.
