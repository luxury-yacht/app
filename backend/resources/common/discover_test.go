package common

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
)

type kindDiscovery struct {
	discovery.DiscoveryInterfaces
	preferred    []*metav1.APIResourceList
	preferredErr error
	groups       []*metav1.APIResourceList
}

type discoverContextKey string

func (d *kindDiscovery) ServerPreferredResources() ([]*metav1.APIResourceList, error) {
	return d.preferred, d.preferredErr
}

func (d *kindDiscovery) ServerGroupsAndResources() ([]*metav1.APIGroup, []*metav1.APIResourceList, error) {
	return nil, d.groups, nil
}

type kindDiscoveryClient struct {
	kubernetes.Interface
	discovery discovery.DiscoveryInterfaces
}

func (c *kindDiscoveryClient) Discovery() discovery.DiscoveryInterfaces { return c.discovery }

func dependenciesWithKindDiscovery(preferred, groups []*metav1.APIResourceList, preferredErr error) Dependencies {
	client := kubernetesfake.NewSimpleClientset()
	return Dependencies{KubernetesClient: &kindDiscoveryClient{
		Interface: client,
		discovery: &kindDiscovery{
			DiscoveryInterfaces: client.Discovery().(*fakediscovery.FakeDiscovery),
			preferred:           preferred, preferredErr: preferredErr, groups: groups,
		},
	}}
}

func TestDiscoverGVRByKindUsesFirstTopLevelDiscoveryMatchDespitePartialError(t *testing.T) {
	deps := dependenciesWithKindDiscovery([]*metav1.APIResourceList{
		{GroupVersion: "too/many/segments", APIResources: []metav1.APIResource{{Name: "widgets", Kind: "Widget"}}},
		{GroupVersion: "example.com/v1", APIResources: []metav1.APIResource{
			{Name: "widgets/status", Kind: "Widget"},
			{Name: "widgets", SingularName: "widget", Kind: "Widget", Namespaced: true},
		}},
		{GroupVersion: "other.example/v1", APIResources: []metav1.APIResource{{Name: "widgets", Kind: "Widget"}}},
	}, nil, errors.New("aggregated API unavailable"))

	gvr, namespaced, err := DiscoverGVRByKind(context.Background(), deps, "WIDGET")
	require.NoError(t, err)
	require.Equal(t, schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}, gvr)
	require.True(t, namespaced)
}

func TestDiscoverGVRByKindFallsBackToGroupsAndResources(t *testing.T) {
	deps := dependenciesWithKindDiscovery(nil, []*metav1.APIResourceList{{
		GroupVersion: "apps/v1",
		APIResources: []metav1.APIResource{{Name: "deployments", SingularName: "deployment", Kind: "Deployment", Namespaced: true}},
	}}, nil)
	gvr, namespaced, err := DiscoverGVRByKind(context.Background(), deps, "deployments")
	require.NoError(t, err)
	require.Equal(t, schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, gvr)
	require.True(t, namespaced)
}

func TestDiscoverGVRByKindRejectsMissingContext(t *testing.T) {
	deps := dependenciesWithKindDiscovery([]*metav1.APIResourceList{{
		GroupVersion: "v1",
		APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod", Namespaced: true}},
	}}, nil, nil)

	var nilContext context.Context
	_, _, err := DiscoverGVRByKind(nilContext, deps, "Pod")
	require.ErrorContains(t, err, "discovery context not initialized")
}

func TestDiscoverGVRByKindFallsBackToCRDStorageVersion(t *testing.T) {
	deps := dependenciesWithKindDiscovery([]*metav1.APIResourceList{{
		GroupVersion: "v1", APIResources: []metav1.APIResource{{Name: "pods", Kind: "Pod"}},
	}}, nil, nil)
	deps.APIExtensionsClient = apiextensionsfake.NewSimpleClientset(&apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Names: apiextensionsv1.CustomResourceDefinitionNames{Plural: "widgets", Kind: "Widget"},
			Scope: apiextensionsv1.NamespaceScoped,
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1alpha1", Served: true},
				{Name: "v1", Served: true, Storage: true},
			},
		},
	})

	gvr, namespaced, err := DiscoverGVRByKind(context.Background(), deps, "widget")
	require.NoError(t, err)
	require.Equal(t, schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}, gvr)
	require.True(t, namespaced)
}

func TestDiscoverGVRByKindFailureContracts(t *testing.T) {
	_, _, err := DiscoverGVRByKind(context.Background(), Dependencies{}, "Widget")
	require.ErrorContains(t, err, "kubernetes client not initialized")

	deps := dependenciesWithKindDiscovery(nil, nil, nil)
	_, _, err = DiscoverGVRByKind(context.Background(), deps, "Missing")
	require.ErrorContains(t, err, "resource type Missing not found")
}

func TestKindDiscoveryHelpersCoverContextAndCRDVersionFallbacks(t *testing.T) {
	fallback := context.WithValue(context.Background(), discoverContextKey("source"), "fallback")
	var nilContext context.Context
	resolved, err := kindDiscoveryContext(fallback)
	require.NoError(t, err)
	require.Same(t, fallback, resolved)
	_, err = kindDiscoveryContext(nilContext)
	require.ErrorContains(t, err, "discovery context not initialized")

	crd := apiextensionsv1.CustomResourceDefinition{Spec: apiextensionsv1.CustomResourceDefinitionSpec{
		Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1alpha1", Served: true}},
	}}
	require.Equal(t, "v1alpha1", preferredCRDVersion(crd))
	require.Empty(t, preferredCRDVersion(apiextensionsv1.CustomResourceDefinition{}))

	deps := dependenciesWithKindDiscovery(nil, nil, nil)
	deps.APIExtensionsClient = apiextensionsfake.NewSimpleClientset(crd.DeepCopy())
	_, found := findCRDKind(context.Background(), deps, "Missing")
	require.False(t, found)
}
