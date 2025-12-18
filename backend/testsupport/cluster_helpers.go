package testsupport

import (
	"testing"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"
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
		copy := *l
		copyLists[i] = &copy
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

// SeedPodMetrics registers pod metrics in the supplied metrics fake client.
func SeedPodMetrics(t testing.TB, client *metricsfake.Clientset, metrics ...*metricsv1beta1.PodMetrics) {
	t.Helper()
	if client == nil {
		t.Fatalf("SeedPodMetrics requires a metrics client")
	}

	for _, m := range metrics {
		if m == nil {
			continue
		}
		if err := client.Tracker().Add(m); err != nil {
			t.Fatalf("failed to add pod metrics %s/%s: %v", m.Namespace, m.Name, err)
		}
	}
}

// NewCRDResourceList returns a discovery list for the supplied CRDs, easing ServerPreferredResources tests.
func NewCRDResourceList(crds ...*apiextensionsv1.CustomResourceDefinition) *metav1.APIResourceList {
	list := &metav1.APIResourceList{
		GroupVersion: "apiextensions.k8s.io/v1",
		APIResources: []metav1.APIResource{},
	}
	for _, crd := range crds {
		if crd == nil {
			continue
		}
		list.APIResources = append(list.APIResources, metav1.APIResource{
			Name:         crd.Spec.Names.Plural,
			SingularName: crd.Spec.Names.Singular,
			Namespaced:   crd.Spec.Scope == apiextensionsv1.NamespaceScoped,
			Kind:         crd.Spec.Names.Kind,
			Verbs:        metav1.Verbs{"get", "list", "watch"},
		})
	}
	return list
}

// NewAPIResourceList helper to craft discovery responses for arbitrary group/versions.
func NewAPIResourceList(groupVersion string, resources ...metav1.APIResource) *metav1.APIResourceList {
	return &metav1.APIResourceList{
		GroupVersion: groupVersion,
		APIResources: append([]metav1.APIResource{}, resources...),
	}
}
