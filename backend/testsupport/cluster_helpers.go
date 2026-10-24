package testsupport

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes"
)

// SeedAPIResources configures the fake discovery client with the supplied API resources.
func SeedAPIResources(t testing.TB, client kubernetes.Interface, lists ...*metav1.APIResourceList) {
	t.Helper()

	if client == nil {
		t.Fatalf("SeedAPIResources requires a Kubernetes client")
	}

	discoveryClient, ok := client.Discovery().(*fakediscovery.FakeDiscovery)
	if !ok {
		t.Fatalf("SeedAPIResources expects a fake discovery client; got %T", client.Discovery())
	}

	copyLists := make([]*metav1.APIResourceList, len(lists))
	for i, l := range lists {
		listCopy := *l
		copyLists[i] = &listCopy
	}
	discoveryClient.Resources = copyLists
}

// NewScheme constructs a runtime.Scheme and applies the supplied add-to-scheme functions.
func NewScheme(t testing.TB, addFns ...func(*runtime.Scheme) error) *runtime.Scheme {
	t.Helper()

	scheme := runtime.NewScheme()
	for _, add := range addFns {
		if err := add(scheme); err != nil {
			t.Fatalf("failed to register scheme: %v", err)
		}
	}
	return scheme
}

// NewDynamicClient constructs a dynamic fake client with the provided objects.
func NewDynamicClient(t testing.TB, scheme *runtime.Scheme, objects ...runtime.Object) *fake.FakeDynamicClient {
	t.Helper()
	if scheme == nil {
		scheme = runtime.NewScheme()
	}
	return fake.NewSimpleDynamicClient(scheme, objects...)
}

// NewAPIResourceList helper to craft discovery responses for arbitrary group/versions.
func NewAPIResourceList(groupVersion string, resources ...metav1.APIResource) *metav1.APIResourceList {
	return &metav1.APIResourceList{
		GroupVersion: groupVersion,
		APIResources: append([]metav1.APIResource{}, resources...),
	}
}
