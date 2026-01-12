package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsscheme "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/scheme"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/testsupport"
)

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
		logger:    noopLogger{},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterCustomDomainName, snapshot.Domain)
	payload, ok := snapshot.Payload.(ClusterCustomSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 1)
	require.NotZero(t, snapshot.Version, "cluster resources=%d", len(payload.Resources))

	entry := payload.Resources[0]
	require.Equal(t, "Widget", entry.Kind)
	require.Equal(t, "cluster-widget", entry.Name)
	require.Equal(t, "acme.test", entry.APIGroup)
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
		logger:    noopLogger{},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterCustomDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(ClusterCustomSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 1)
	require.NotZero(t, snapshot.Version, "cluster resources=%d", len(payload.Resources))

	entry := payload.Resources[0]
	require.Equal(t, "global-widget", entry.Name)
	require.Equal(t, "acme.test", entry.APIGroup)
	require.NotEmpty(t, entry.Kind)
}

func registerWidgetTypes(t testing.TB, scheme *runtime.Scheme) {
	t.Helper()
	gvk := schema.GroupVersionKind{Group: "acme.test", Version: "v1", Kind: "Widget"}
	scheme.AddKnownTypeWithName(gvk, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(gvk.GroupVersion().WithKind("WidgetList"), &unstructured.UnstructuredList{})
}
