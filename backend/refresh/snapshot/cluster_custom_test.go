package snapshot

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsscheme "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/scheme"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestClusterCustomBuilderEmptyAndDependencyContracts(t *testing.T) {
	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))

	t.Run("missing CRD lister", func(t *testing.T) {
		builder := &ClusterCustomBuilder{dynamic: testsupport.NewDynamicClient(t, scheme)}
		_, err := builder.Build(context.Background(), "")
		require.EqualError(t, err, "crd lister not initialised")
	})

	t.Run("missing dynamic client", func(t *testing.T) {
		builder := &ClusterCustomBuilder{crdLister: testsupport.NewCRDLister(t)}
		_, err := builder.Build(context.Background(), "")
		require.EqualError(t, err, "dynamic client not initialised")
	})

	t.Run("empty discovery keeps cluster identity", func(t *testing.T) {
		builder := &ClusterCustomBuilder{
			dynamic:   testsupport.NewDynamicClient(t, scheme),
			crdLister: testsupport.NewCRDLister(t),
			logger:    applog.Noop,
		}
		meta := ClusterMeta{ClusterID: "cluster-empty", ClusterName: "Empty"}
		snapshot, err := builder.Build(WithClusterMeta(context.Background(), meta), "")
		require.NoError(t, err)
		require.Zero(t, snapshot.Version)
		require.Zero(t, snapshot.Stats.ItemCount)
		payload := snapshot.Payload.(ClusterCustomSnapshot)
		require.Equal(t, meta, payload.ClusterMeta)
		require.NotNil(t, payload.Resources)
		require.NotNil(t, payload.Kinds)
	})
}

func TestClusterCustomBuilderPreservesPartialResultsAndIdentity(t *testing.T) {
	now := time.Now()
	goodCRD := clusterCustomTestCRD("widgets.acme.test", "acme.test", "widgets", "Widget")
	badCRD := clusterCustomTestCRD("gadgets.broken.test", "broken.test", "gadgets", "Gadget")
	good := clusterCustomTestResource(now, "acme.test/v1", "Widget", "shared-name")

	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerCustomTestTypes(scheme, "acme.test", "Widget")
	registerCustomTestTypes(scheme, "broken.test", "Gadget")
	dynamicClient := testsupport.NewDynamicClient(t, scheme, good)
	dynamicClient.PrependReactor("list", "gadgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("discovery metadata is stale")
	})

	builder := &ClusterCustomBuilder{
		dynamic:   dynamicClient,
		crdLister: testsupport.NewCRDLister(t, goodCRD, badCRD),
		logger:    applog.Noop,
	}
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	snapshot, err := builder.Build(WithClusterMeta(context.Background(), meta), "")
	require.ErrorContains(t, err, "discovery metadata is stale")
	require.Len(t, snapshot.Stats.Warnings, 1)

	payload := snapshot.Payload.(ClusterCustomSnapshot)
	require.Equal(t, meta, payload.ClusterMeta)
	require.Equal(t, []string{"Gadget", "Widget"}, payload.Kinds)
	require.Len(t, payload.Resources, 1)
	require.Equal(t, "cluster-a", payload.Resources[0].Ref.ClusterID)
	require.Equal(t, "acme.test", payload.Resources[0].Ref.Group)
	require.Equal(t, "v1", payload.Resources[0].Ref.Version)
	require.Equal(t, "widgets", payload.Resources[0].Ref.Resource)
	require.Empty(t, payload.Resources[0].Ref.Namespace)
}

func TestClusterCustomBuilderTreatsForbiddenDiscoveryAsUnavailable(t *testing.T) {
	crd := clusterCustomTestCRD("widgets.acme.test", "acme.test", "widgets", "Widget")
	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerCustomTestTypes(scheme, "acme.test", "Widget")
	dynamicClient := testsupport.NewDynamicClient(t, scheme)
	dynamicClient.PrependReactor("list", "widgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "acme.test", Resource: "widgets"}, "", errors.New("denied"))
	})
	builder := &ClusterCustomBuilder{
		dynamic: dynamicClient, crdLister: testsupport.NewCRDLister(t, crd), logger: applog.Noop,
	}

	snapshot, err := builder.Build(WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"}), "")
	require.NoError(t, err)
	require.Empty(t, snapshot.Stats.Warnings)
	payload := snapshot.Payload.(ClusterCustomSnapshot)
	require.Equal(t, []string{"Widget"}, payload.Kinds)
	require.NotNil(t, payload.Resources)
	require.Empty(t, payload.Resources)
}

func TestClusterCustomBuilderKeepsCollidingKindsDistinctAcrossGroups(t *testing.T) {
	now := time.Now()
	crdA := clusterCustomTestCRD("widgets.alpha.test", "alpha.test", "widgets", "Widget")
	crdB := clusterCustomTestCRD("widgets.beta.test", "beta.test", "widgets", "Widget")
	resourceA := clusterCustomTestResource(now, "alpha.test/v1", "Widget", "shared")
	resourceB := clusterCustomTestResource(now, "beta.test/v1", "Widget", "shared")

	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerCustomTestTypes(scheme, "alpha.test", "Widget")
	registerCustomTestTypes(scheme, "beta.test", "Widget")
	builder := &ClusterCustomBuilder{
		dynamic:   testsupport.NewDynamicClient(t, scheme, resourceA, resourceB),
		crdLister: testsupport.NewCRDLister(t, crdA, crdB),
		logger:    applog.Noop,
	}

	snapshot, err := builder.Build(WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"}), "")
	require.NoError(t, err)
	payload := snapshot.Payload.(ClusterCustomSnapshot)
	require.Len(t, payload.Resources, 2)
	require.ElementsMatch(t, []string{"alpha.test", "beta.test"}, []string{
		payload.Resources[0].Ref.Group,
		payload.Resources[1].Ref.Group,
	})
	for _, resource := range payload.Resources {
		require.Equal(t, "cluster-a", resource.Ref.ClusterID)
		require.Equal(t, "v1", resource.Ref.Version)
		require.Equal(t, "Widget", resource.Ref.Kind)
		require.Equal(t, "shared", resource.Ref.Name)
	}
}

func clusterCustomTestCRD(name, group, plural, kind string) *apiextensionsv1.CustomResourceDefinition {
	return &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: "5"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: group,
			Scope: apiextensionsv1.ClusterScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{Plural: plural, Kind: kind},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name: "v1", Served: true, Storage: true,
			}},
		},
	}
}

func clusterCustomTestResource(now time.Time, apiVersion, kind, name string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiVersion,
		"kind":       kind,
		"metadata": map[string]any{
			"name":              name,
			"resourceVersion":   "10",
			"creationTimestamp": metav1.NewTime(now.Add(-time.Hour)).Format(time.RFC3339),
		},
	}}
}

func registerCustomTestTypes(scheme *runtime.Scheme, group, kind string) {
	gvk := schema.GroupVersionKind{Group: group, Version: "v1", Kind: kind}
	scheme.AddKnownTypeWithName(gvk, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(gvk.GroupVersion().WithKind(kind+"List"), &unstructured.UnstructuredList{})
}

func TestClusterCustomBuilder(t *testing.T) {
	now := time.Now()

	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "widgets.acme.test",
			ResourceVersion:   "5",
			CreationTimestamp: metav1.NewTime(now.Add(-24 * time.Hour)),
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "acme.test",
			Scope: apiextensionsv1.ClusterScoped,
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

	resource := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "acme.test/v1",
			"kind":       "Widget",
			"metadata": map[string]any{
				"name":              "cluster-widget",
				"resourceVersion":   "10",
				"creationTimestamp": metav1.NewTime(now.Add(-1 * time.Hour)).Format(time.RFC3339),
			},
		},
	}

	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerWidgetTypes(t, scheme)

	dynamicClient := testsupport.NewDynamicClient(t, scheme, resource)

	builder := &ClusterCustomBuilder{
		dynamic:   dynamicClient,
		crdLister: testsupport.NewCRDLister(t, crd),
		logger:    applog.Noop,
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterCustomDomainName, snapshot.Domain)
	payload, ok := snapshot.Payload.(ClusterCustomSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 1)
	require.Equal(t, []string{"Widget"}, payload.Kinds)
	require.NotZero(t, snapshot.Version, "cluster resources=%d", len(payload.Resources))

	entry := payload.Resources[0]
	require.Equal(t, "Widget", entry.Ref.Kind)
	require.Equal(t, "cluster-widget", entry.Ref.Name)
	require.Equal(t, "acme.test", entry.Ref.Group)
	require.NotEmpty(t, entry.Age)
}

func TestClusterCustomBuilderMultipleCRDs(t *testing.T) {
	now := time.Now()

	clusterCRD := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "widgets.acme.test",
			ResourceVersion:   "5",
			CreationTimestamp: metav1.NewTime(now.Add(-24 * time.Hour)),
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "acme.test",
			Scope: apiextensionsv1.ClusterScoped,
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

	namespacedCRD := clusterCRD.DeepCopy()
	namespacedCRD.Name = "gadgets.example.test"
	namespacedCRD.Spec.Scope = apiextensionsv1.NamespaceScoped
	namespacedCRD.Spec.Names.Plural = "gadgets"
	namespacedCRD.Spec.Names.Kind = "Gadget"

	clusterResource := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "acme.test/v1",
			"kind":       "Widget",
			"metadata": map[string]any{
				"name":              "global-widget",
				"resourceVersion":   "15",
				"creationTimestamp": metav1.NewTime(now.Add(-2 * time.Hour)).Format(time.RFC3339),
			},
		},
	}

	namespacedResource := clusterResource.DeepCopy()
	namespacedResource.SetNamespace("default")
	namespacedResource.SetName("namespaced-widget")
	require.Empty(t, clusterResource.GetNamespace(), "cluster resource must remain cluster-scoped")

	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerWidgetTypes(t, scheme)

	dynamicClient := testsupport.NewDynamicClient(t, scheme, clusterResource)

	builder := &ClusterCustomBuilder{
		dynamic:   dynamicClient,
		crdLister: testsupport.NewCRDLister(t, clusterCRD, namespacedCRD),
		logger:    applog.Noop,
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterCustomDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(ClusterCustomSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 1)
	require.Equal(t, []string{"Widget"}, payload.Kinds)
	require.NotZero(t, snapshot.Version, "cluster resources=%d", len(payload.Resources))

	entry := payload.Resources[0]
	require.Equal(t, "global-widget", entry.Ref.Name)
	require.Equal(t, "acme.test", entry.Ref.Group)
	require.NotEmpty(t, entry.Ref.Kind)
}

func TestClusterCustomBuilderSkipsFirstClassGatewayCRDs(t *testing.T) {
	widgetCRD := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.acme.test"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "acme.test",
			Scope: apiextensionsv1.ClusterScoped,
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
	gatewayClassCRD := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "gatewayclasses.gateway.networking.k8s.io"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "gateway.networking.k8s.io",
			Scope: apiextensionsv1.ClusterScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "gatewayclasses",
				Kind:   "GatewayClass",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	}

	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerWidgetTypes(t, scheme)

	builder := &ClusterCustomBuilder{
		dynamic:   testsupport.NewDynamicClient(t, scheme),
		crdLister: testsupport.NewCRDLister(t, widgetCRD, gatewayClassCRD),
		logger:    applog.Noop,
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(ClusterCustomSnapshot)
	require.True(t, ok)
	require.Equal(t, []string{"Widget"}, payload.Kinds)
	require.Empty(t, payload.Resources)
}

func registerWidgetTypes(t testing.TB, scheme *runtime.Scheme) {
	t.Helper()
	gvk := schema.GroupVersionKind{Group: "acme.test", Version: "v1", Kind: "Widget"}
	scheme.AddKnownTypeWithName(gvk, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(gvk.GroupVersion().WithKind("WidgetList"), &unstructured.UnstructuredList{})
}
