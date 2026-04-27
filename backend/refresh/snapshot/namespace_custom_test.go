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

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

func TestSortNamespaceCustomSummaries(t *testing.T) {
	items := []NamespaceCustomSummary{
		{Namespace: "staging", APIGroup: "apps.example.com", Kind: "Widget", Name: "zeta"},
		{Namespace: "default", APIGroup: "alpha.example.com", Kind: "Gadget", Name: "beta"},
		{Namespace: "default", APIGroup: "alpha.example.com", Kind: "Gadget", Name: "alpha"},
		{Namespace: "default", APIGroup: "beta.example.com", Kind: "Gadget", Name: "a"},
	}

	sortNamespaceCustomSummaries(items)

	require.Equal(t, []NamespaceCustomSummary{
		{Namespace: "default", APIGroup: "alpha.example.com", Kind: "Gadget", Name: "alpha"},
		{Namespace: "default", APIGroup: "alpha.example.com", Kind: "Gadget", Name: "beta"},
		{Namespace: "default", APIGroup: "beta.example.com", Kind: "Gadget", Name: "a"},
		{Namespace: "staging", APIGroup: "apps.example.com", Kind: "Widget", Name: "zeta"},
	}, items)
}

func TestNamespaceCustomBuilderPublishesKindsFromDiscoveredCRDs(t *testing.T) {
	now := time.Now()

	namespacedCRD := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name: "widgets.acme.test",
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "acme.test",
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

	otherNamespacedCRD := namespacedCRD.DeepCopy()
	otherNamespacedCRD.Name = "dbclusters.postgresql.cnpg.io"
	otherNamespacedCRD.Spec.Group = "postgresql.cnpg.io"
	otherNamespacedCRD.Spec.Names.Plural = "dbclusters"
	otherNamespacedCRD.Spec.Names.Kind = "DBCluster"

	resource := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "acme.test/v1",
			"kind":       "Widget",
			"metadata": map[string]any{
				"name":              "widget-a",
				"namespace":         "team-a",
				"resourceVersion":   "10",
				"creationTimestamp": metav1.NewTime(now.Add(-1 * time.Hour)).Format(time.RFC3339),
			},
		},
	}

	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerWidgetTypes(t, scheme)
	registerDBClusterTypes(t, scheme)

	builder := &NamespaceCustomBuilder{
		dynamic:   testsupport.NewDynamicClient(t, scheme, resource),
		crdLister: testsupport.NewCRDLister(t, namespacedCRD, otherNamespacedCRD),
		logger:    noopLogger{},
	}

	snapshot, err := builder.Build(context.Background(), "cluster-a::namespace:team-a")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceCustomSnapshot)
	require.True(t, ok)
	require.Equal(t, []string{"DBCluster", "Widget"}, payload.Kinds)
}

func TestNamespaceCustomBuilderSkipsFirstClassGatewayCRDs(t *testing.T) {
	widgetCRD := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.acme.test"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "acme.test",
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
	gatewayCRD := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "gateways.gateway.networking.k8s.io"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "gateway.networking.k8s.io",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "gateways",
				Kind:   "Gateway",
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

	builder := &NamespaceCustomBuilder{
		dynamic:   testsupport.NewDynamicClient(t, scheme),
		crdLister: testsupport.NewCRDLister(t, widgetCRD, gatewayCRD),
		logger:    noopLogger{},
	}

	snapshot, err := builder.Build(context.Background(), "cluster-a::namespace:team-a")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceCustomSnapshot)
	require.True(t, ok)
	require.Equal(t, []string{"Widget"}, payload.Kinds)
	require.Empty(t, payload.Resources)
}

func registerDBClusterTypes(t testing.TB, scheme *runtime.Scheme) {
	t.Helper()
	gvk := schema.GroupVersionKind{Group: "postgresql.cnpg.io", Version: "v1", Kind: "DBCluster"}
	scheme.AddKnownTypeWithName(gvk, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(gvk.GroupVersion().WithKind("DBClusterList"), &unstructured.UnstructuredList{})
}
