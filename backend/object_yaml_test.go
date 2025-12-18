package backend

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
)

func resetGVRCache() {
	gvrCacheMutex.Lock()
	defer gvrCacheMutex.Unlock()
	gvrCache = make(map[string]gvrCacheEntry)
}

func TestGetObjectYAMLAggregatesEndpointSlices(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.client = kubernetesfake.NewSimpleClientset()

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
	_, err := app.client.DiscoveryV1().EndpointSlices("demo").Create(context.Background(), slice, metav1.CreateOptions{})
	if err != nil {
		t.Fatalf("failed to seed endpoint slice: %v", err)
	}

	yamlStr, err := app.GetObjectYAML("endpointslice", "demo", "svc")
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
	app.client = kubernetesfake.NewSimpleClientset()

	discovery := app.client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{{
				Name:         "pods",
				SingularName: "pod",
				Namespaced:   true,
				Kind:         "Pod",
			}},
		},
	}
	gvrCacheMutex.Lock()
	gvrCache["Pod"] = gvrCacheEntry{
		gvr:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		namespaced: true,
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
	app.dynamicClient = dynamicfake.NewSimpleDynamicClient(scheme, pod)

	yamlStr, err := app.GetObjectYAML("Pod", "demo", "demo-pod")
	if err != nil {
		t.Fatalf("GetObjectYAML returned error: %v", err)
	}
	if !strings.Contains(yamlStr, "name: demo-pod") || !strings.Contains(yamlStr, "namespace: demo") {
		t.Fatalf("unexpected YAML output:\n%s", yamlStr)
	}
}

func TestGetObjectYAMLClusterScopedResource(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.client = kubernetesfake.NewSimpleClientset()

	discovery := app.client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{{
				Name:         "nodes",
				SingularName: "node",
				Namespaced:   false,
				Kind:         "Node",
			}},
		},
	}
	gvrCacheMutex.Lock()
	gvrCache["node"] = gvrCacheEntry{
		gvr:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"},
		namespaced: false,
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
	app.dynamicClient = dynamicfake.NewSimpleDynamicClient(scheme, node)

	yamlStr, err := app.GetObjectYAML("node", "", "node-1")
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
	app.client = kubernetesfake.NewSimpleClientset()

	discovery := app.client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{{
				Name:         "pods",
				SingularName: "pod",
				Namespaced:   true,
				Kind:         "Pod",
			}},
		},
	}

	_, err := app.GetObjectYAML("pod", "demo", "missing")
	if err == nil || !strings.Contains(err.Error(), "dynamic client not initialized") {
		t.Fatalf("expected dynamic client error, got %v", err)
	}
}

func TestGetGVRFallsBackToCRD(t *testing.T) {
	resetGVRCache()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.client = kubernetesfake.NewSimpleClientset()

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
	app.apiextensionsClient = apiextensionsfake.NewSimpleClientset(crd)

	gvr, namespaced, err := app.getGVR("Widget")
	if err != nil {
		t.Fatalf("getGVR error: %v", err)
	}
	if !namespaced || gvr.Resource != "widgets" || gvr.Group != "example.com" {
		t.Fatalf("unexpected gvr %+v namespaced=%v", gvr, namespaced)
	}
}

func TestListEndpointSlicesRequiresClient(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	list, err := app.listEndpointSlicesForService("demo", "svc")
	if err == nil || list != nil {
		t.Fatalf("expected nil endpoint slices and error for missing client, got %+v %v", list, err)
	}
}
