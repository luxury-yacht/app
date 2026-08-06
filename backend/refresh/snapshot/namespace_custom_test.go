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
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestNamespaceCustomBuilderValidationAndEmptyDiscovery(t *testing.T) {
	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	dynamicClient := testsupport.NewDynamicClient(t, scheme)

	t.Run("invalid scope", func(t *testing.T) {
		builder := &NamespaceCustomBuilder{dynamic: dynamicClient, crdLister: testsupport.NewCRDLister(t)}
		_, err := builder.Build(context.Background(), "")
		require.ErrorContains(t, err, "namespace scope is required")
	})

	t.Run("missing CRD lister", func(t *testing.T) {
		builder := &NamespaceCustomBuilder{dynamic: dynamicClient}
		_, err := builder.Build(context.Background(), "cluster-a|namespace:team-a")
		require.EqualError(t, err, "crd lister not initialised")
	})

	t.Run("empty discovery keeps canonical scope and cluster identity", func(t *testing.T) {
		builder := &NamespaceCustomBuilder{
			dynamic: dynamicClient, crdLister: testsupport.NewCRDLister(t), logger: applog.Noop,
		}
		meta := ClusterMeta{ClusterID: "cluster-empty", ClusterName: "Empty"}
		snapshot, err := builder.Build(
			WithClusterMeta(context.Background(), meta),
			"cluster-empty|namespace:team-a",
		)
		require.NoError(t, err)
		require.Equal(t, "cluster-empty|namespace:team-a", snapshot.Scope)
		payload := snapshot.Payload.(NamespaceCustomSnapshot)
		require.Equal(t, meta, payload.ClusterMeta)
		require.NotNil(t, payload.Resources)
		require.NotNil(t, payload.Kinds)
	})
}

func TestNamespaceCustomBuilderPreservesPartialFanoutAndIdentity(t *testing.T) {
	now := time.Now()
	goodCRD := clusterCustomTestCRD("widgets.acme.test", "acme.test", "widgets", "Widget")
	goodCRD.Spec.Scope = apiextensionsv1.NamespaceScoped
	badCRD := clusterCustomTestCRD("gadgets.broken.test", "broken.test", "gadgets", "Gadget")
	badCRD.Spec.Scope = apiextensionsv1.NamespaceScoped
	good := clusterCustomTestResource(now, "acme.test/v1", "Widget", "shared-name")
	good.SetNamespace("team-a")

	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerCustomTestTypes(scheme, "acme.test", "Widget")
	registerCustomTestTypes(scheme, "broken.test", "Gadget")
	dynamicClient := testsupport.NewDynamicClient(t, scheme, good)
	dynamicClient.PrependReactor("list", "gadgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("stale CRD discovery entry")
	})

	builder := &NamespaceCustomBuilder{
		dynamic:   dynamicClient,
		crdLister: testsupport.NewCRDLister(t, goodCRD, badCRD),
		logger:    applog.Noop,
		scope:     []string{"team-a", "team-b"},
	}
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	snapshot, err := builder.Build(
		WithClusterMeta(context.Background(), meta),
		"cluster-a|namespace:all",
	)
	require.NoError(t, err)
	require.Len(t, snapshot.Stats.Warnings, 1)
	payload := snapshot.Payload.(NamespaceCustomSnapshot)
	require.Equal(t, meta, payload.ClusterMeta)
	require.Equal(t, []string{"Gadget", "Widget"}, payload.Kinds)
	require.Len(t, payload.Resources, 1)
	ref := payload.Resources[0].Ref
	require.Equal(t, "cluster-a", ref.ClusterID)
	require.Equal(t, "acme.test", ref.Group)
	require.Equal(t, "v1", ref.Version)
	require.Equal(t, "widgets", ref.Resource)
	require.Equal(t, "team-a", ref.Namespace)
}

func TestNamespaceCustomBuilderTreatsForbiddenNamespaceAsUnavailable(t *testing.T) {
	crd := clusterCustomTestCRD("widgets.acme.test", "acme.test", "widgets", "Widget")
	crd.Spec.Scope = apiextensionsv1.NamespaceScoped
	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerCustomTestTypes(scheme, "acme.test", "Widget")
	dynamicClient := testsupport.NewDynamicClient(t, scheme)
	dynamicClient.PrependReactor("list", "widgets", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "acme.test", Resource: "widgets"}, "", errors.New("denied"))
	})
	builder := &NamespaceCustomBuilder{
		dynamic: dynamicClient, crdLister: testsupport.NewCRDLister(t, crd), logger: applog.Noop,
	}

	snapshot, err := builder.Build(
		WithClusterMeta(context.Background(), ClusterMeta{ClusterID: "cluster-a"}),
		"cluster-a|namespace:team-a",
	)
	require.NoError(t, err)
	require.Empty(t, snapshot.Stats.Warnings)
	payload := snapshot.Payload.(NamespaceCustomSnapshot)
	require.Equal(t, []string{"Widget"}, payload.Kinds)
	require.NotNil(t, payload.Resources)
	require.Empty(t, payload.Resources)
}

func TestSortNamespaceCustomSummaries(t *testing.T) {
	items := []NamespaceCustomSummary{
		{Ref: resourcemodel.ResourceRef{Group: "apps.example.com", Kind: "Widget", Namespace: "staging", Name: "zeta"}},
		{Ref: resourcemodel.ResourceRef{Group: "alpha.example.com", Kind: "Gadget", Namespace: "default", Name: "beta"}},
		{Ref: resourcemodel.ResourceRef{Group: "alpha.example.com", Kind: "Gadget", Namespace: "default", Name: "alpha"}},
		{Ref: resourcemodel.ResourceRef{Group: "beta.example.com", Kind: "Gadget", Namespace: "default", Name: "a"}},
	}

	sortNamespaceCustomSummaries(items)

	require.Equal(t, []NamespaceCustomSummary{
		{Ref: resourcemodel.ResourceRef{Group: "alpha.example.com", Kind: "Gadget", Namespace: "default", Name: "alpha"}},
		{Ref: resourcemodel.ResourceRef{Group: "alpha.example.com", Kind: "Gadget", Namespace: "default", Name: "beta"}},
		{Ref: resourcemodel.ResourceRef{Group: "beta.example.com", Kind: "Gadget", Namespace: "default", Name: "a"}},
		{Ref: resourcemodel.ResourceRef{Group: "apps.example.com", Kind: "Widget", Namespace: "staging", Name: "zeta"}},
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
		logger:    applog.Noop,
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
		logger:    applog.Noop,
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

// Scoped clusters (docs/plans/namespace-scope.md): the all-namespaces view
// fans the per-CRD LIST over the configured scope instead of one cluster-wide
// LIST the identity cannot perform. A namespace outside the scope must never
// be listed.
func TestNamespaceCustomBuilderAllNamespacesFansOutOverScope(t *testing.T) {
	now := time.Now()
	widgetCRD := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.acme.test"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "acme.test",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{Plural: "widgets", Kind: "Widget"},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name: "v1", Served: true, Storage: true,
			}},
		},
	}

	makeWidget := func(namespace, name string) *unstructured.Unstructured {
		return &unstructured.Unstructured{
			Object: map[string]any{
				"apiVersion": "acme.test/v1",
				"kind":       "Widget",
				"metadata": map[string]any{
					"name":              name,
					"namespace":         namespace,
					"resourceVersion":   "10",
					"creationTimestamp": metav1.NewTime(now.Add(-time.Hour)).Format(time.RFC3339),
				},
			},
		}
	}

	scheme := runtime.NewScheme()
	require.NoError(t, apiextensionsscheme.AddToScheme(scheme))
	registerWidgetTypes(t, scheme)

	builder := &NamespaceCustomBuilder{
		dynamic:   testsupport.NewDynamicClient(t, scheme, makeWidget("team-a", "wa"), makeWidget("team-c", "wc")),
		crdLister: testsupport.NewCRDLister(t, widgetCRD),
		logger:    applog.Noop,
		scope:     []string{"team-a", "team-b"},
	}

	snapshot, err := builder.Build(context.Background(), "cluster-a|namespace:all")
	require.NoError(t, err)
	payload, ok := snapshot.Payload.(NamespaceCustomSnapshot)
	require.True(t, ok)

	require.Equal(t, []string{"Widget"}, payload.Kinds, "CRD discovery must still work under scope")

	var names []string
	for _, item := range payload.Resources {
		names = append(names, item.Ref.Namespace+"/"+item.Ref.Name)
	}
	require.Equal(t, []string{"team-a/wa"}, names,
		"scope namespaces listed, out-of-scope namespaces excluded")
}
