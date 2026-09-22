package ingest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

func dynamicWidgetDefinition() *apiextensionsv1.CustomResourceDefinition {
	return &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com", UID: "definition-a"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{Group: "example.com", Scope: apiextensionsv1.NamespaceScoped,
			Names:    apiextensionsv1.CustomResourceDefinitionNames{Kind: "Widget", Plural: "widgets"},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{Name: "v1", Served: true, Storage: true}},
		},
	}
}

func dynamicTestProjector(DynamicCatalogSpec) CatalogProjector {
	return func(o metav1.Object) interface{} { return dynCatRow{Namespace: o.GetNamespace(), Name: o.GetName()} }
}

func TestCRDSourceUsesServedPreferredVersion(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	crd := dynamicWidgetDefinition()
	crd.Spec.Versions = []apiextensionsv1.CustomResourceDefinitionVersion{
		{Name: "v1", Storage: true}, {Name: "v2", Served: true}, {Name: "v3", Served: true},
	}
	gvrs := map[schema.GroupVersionResource]string{}
	for _, version := range []string{"v1", "v2", "v3"} {
		gvrs[schema.GroupVersionResource{Group: "example.com", Version: version, Resource: "widgets"}] = "WidgetList"
	}
	selected := schema.GroupVersionResource{Group: "example.com", Version: "v3", Resource: "widgets"}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), gvrs,
		newDynUnstructured(selected.GroupVersion().WithKind("Widget"), "allowed", "visible", "1"))
	m := newStartedDynamicManager(ctx, dyn)
	defer m.Stop()
	require.True(t, m.ReconcileCustomResourceDefinition(crd, "v3", dynamicTestProjector))
	require.Eventually(t, func() bool { return m.HasSyncedFor(selected) }, time.Second, time.Millisecond)
	require.Equal(t, []interface{}{dynCatRow{Namespace: "allowed", Name: "visible"}}, m.CatalogRows(selected))
	for _, action := range dyn.Actions() {
		require.Equal(t, selected, action.GetResource())
	}
}

func TestCRDRecreationIgnoresDeletionFromPreviousUID(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	crd := dynamicWidgetDefinition()
	gvr := schema.GroupVersionResource{Group: crd.Spec.Group, Version: "v1", Resource: crd.Spec.Names.Plural}
	dyn := newWidgetDynamicClient(gvr, gvr.GroupVersion().WithKind("Widget"), newDynUnstructured(gvr.GroupVersion().WithKind("Widget"), "default", "visible", "1"))
	m := newStartedDynamicManager(ctx, dyn)
	defer m.Stop()
	require.True(t, m.ReconcileCustomResourceDefinition(crd, "v1", dynamicTestProjector))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, time.Second, time.Millisecond)
	replacement := crd.DeepCopy()
	replacement.UID = "definition-b"
	require.True(t, m.ReconcileCustomResourceDefinition(replacement, "v1", dynamicTestProjector))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, time.Second, time.Millisecond)
	m.RemoveCustomResourceDefinition(crd)
	require.True(t, m.Tracks(gvr), "a late delete for the old definition must not retire the replacement")
	require.Len(t, m.CatalogRows(gvr), 1)
	m.RemoveCustomResourceDefinition(replacement)
	require.False(t, m.Tracks(gvr))
	require.Empty(t, m.CatalogRows(gvr))
	m.RemoveCustomResourceDefinition(replacement)
}

func TestCRDScopeReplacementChangesWatchPartitions(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	crd := dynamicWidgetDefinition()
	gvr := schema.GroupVersionResource{Group: crd.Spec.Group, Version: "v1", Resource: crd.Spec.Names.Plural}
	gvk := gvr.GroupVersion().WithKind("Widget")
	dyn := newWidgetDynamicClient(gvr, gvk, newDynUnstructured(gvk, "team-a", "a", "1"), newDynUnstructured(gvk, "team-b", "b", "1"))
	m := newStartedDynamicManager(ctx, dyn)
	defer m.Stop()
	m.scope = []string{"team-a", "team-b"}
	require.True(t, m.ReconcileCustomResourceDefinition(crd, "v1", dynamicTestProjector))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, time.Second, time.Millisecond)
	require.Len(t, m.CatalogRows(gvr), 2)
	require.NoError(t, dyn.Tracker().Delete(gvr, "team-a", "a"))
	require.NoError(t, dyn.Tracker().Delete(gvr, "team-b", "b"))
	require.NoError(t, dyn.Tracker().Add(newDynUnstructured(gvk, "", "cluster-object", "2")))
	replacement := crd.DeepCopy()
	replacement.UID = "cluster-scoped-definition"
	replacement.Spec.Scope = apiextensionsv1.ClusterScoped
	dyn.ClearActions()
	require.True(t, m.ReconcileCustomResourceDefinition(replacement, "v1", dynamicTestProjector))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, time.Second, time.Millisecond)
	require.Equal(t, []interface{}{dynCatRow{Name: "cluster-object"}}, m.CatalogRows(gvr))
	for _, action := range dyn.Actions() {
		require.Empty(t, action.GetNamespace(), "cluster-scoped definitions must not reuse namespace partitions")
	}
}

func TestIncompleteCRDDefinitionRetainsLiveSource(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	crd := dynamicWidgetDefinition()
	gvr := schema.GroupVersionResource{Group: crd.Spec.Group, Version: "v1", Resource: crd.Spec.Names.Plural}
	gvk := gvr.GroupVersion().WithKind("Widget")
	dyn := newWidgetDynamicClient(gvr, gvk, newDynUnstructured(gvk, "default", "visible", "1"))
	m := newStartedDynamicManager(ctx, dyn)
	defer m.Stop()
	require.True(t, m.ReconcileCustomResourceDefinition(crd, "v1", dynamicTestProjector))
	require.Eventually(t, func() bool { return m.HasSyncedFor(gvr) }, time.Second, time.Millisecond)
	crd.Spec.Versions[0].Served = false
	require.False(t, m.ReconcileCustomResourceDefinition(crd, "v1", dynamicTestProjector))
	require.True(t, m.HasSyncedFor(gvr))
	require.Len(t, m.CatalogRows(gvr), 1)
}

func TestCRDSourceKeepsRegisteredGatewayOwnership(t *testing.T) {
	disableWatchList(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	crd := dynamicWidgetDefinition()
	crd.Spec.Group = "gateway.networking.k8s.io"
	crd.Spec.Names.Kind, crd.Spec.Names.Plural = "Gateway", "gateways"
	gvr := schema.GroupVersionResource{Group: crd.Spec.Group, Version: "v1", Resource: crd.Spec.Names.Plural}
	dyn := newWidgetDynamicClient(gvr, gvr.GroupVersion().WithKind("Gateway"))
	m := newStartedDynamicManager(ctx, dyn)
	defer m.Stop()
	require.False(t, m.ReconcileCustomResourceDefinition(crd, "v1", dynamicTestProjector))
	require.False(t, m.Tracks(gvr))
	require.Empty(t, dyn.Actions(), "registered Gateway sources must not gain a second dynamic watcher")
}
