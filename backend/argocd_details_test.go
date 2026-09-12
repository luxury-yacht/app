package backend

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestArgoCDDetailsKeepNamespaceClusterAndLiveStatus(t *testing.T) {
	gvk := schema.GroupVersionKind{Group: "argoproj.io", Version: "v1alpha1", Kind: "Application"}
	client := fake.NewClientset()
	client.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{GroupVersion: gvk.GroupVersion().String(), APIResources: []metav1.APIResource{{Name: "applications", Kind: "Application", Namespaced: true, Verbs: metav1.Verbs{"list", "get"}}}}}
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": gvk.GroupVersion().String(), "kind": gvk.Kind,
		"metadata": map[string]any{"name": "shop", "namespace": "team-a", "resourceVersion": "1"},
		"spec":     map[string]any{"project": "production", "destination": map[string]any{"name": "remote-prod", "namespace": "store"}},
		"status":   map[string]any{"sync": map[string]any{"status": "OutOfSync"}, "health": map[string]any{"status": "Degraded"}},
	}}
	other := object.DeepCopy()
	other.SetNamespace("team-b")
	require.NoError(t, unstructured.SetNestedField(other.Object, "Healthy", "status", "health", "status"))
	dynamic := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), object, other)
	gateway := newObjectDetailResourceGateway(map[string]*clusterClients{"a": {meta: ClusterMeta{ID: "a", Name: "a"}, client: client, dynamicClient: dynamic}})
	gateway.responseCache = newResponseCache(time.Minute, 20)
	provider := gateway.objectDetailProvider()
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: "a"})
	raw, err := provider.FetchObjectDetails(ctx, gvk, "team-a", "shop")
	require.NoError(t, err)
	detail := raw.(*customresource.Details)
	require.Equal(t, "argocd", detail.ResourceFamily)
	require.Equal(t, "a", detail.Ref.ClusterID)
	require.Equal(t, "team-a", detail.Ref.Namespace)
	require.Equal(t, "applications", detail.Ref.Resource)
	require.Equal(t, "Degraded", detail.Status)
	require.Equal(t, "error", detail.StatusPresentation)
	rows, err := gateway.HydrateCatalogCustomRows("a", []snapshot.ResourceQueryRow{{ClusterID: "a", Group: gvk.Group, Version: gvk.Version, Kind: gvk.Kind, Resource: "applications", Namespace: "team-a", Name: "shop"}})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, detail.Ref, rows[0].Ref)
	require.Equal(t, detail.Status, rows[0].Status)
	require.Equal(t, detail.Status, rows[0].ArgoCD.Health)
	require.Equal(t, detail.ArgoCD.Application.Sync, rows[0].ArgoCD.Sync)
	require.Equal(t, "production", rows[0].ArgoCD.Project)
	require.Equal(t, "remote-prod", rows[0].ArgoCD.Destination)
	require.Equal(t, "store", rows[0].ArgoCD.DestinationNamespace)
	raw, err = provider.FetchObjectDetails(ctx, gvk, "team-b", "shop")
	require.NoError(t, err)
	require.Equal(t, "Healthy", raw.(*customresource.Details).Status)
	_, err = provider.FetchObjectDetails(ctx, gvk, "", "shop")
	require.Error(t, err)
	_, err = provider.FetchObjectDetails(ctx, gvk, "missing", "shop")
	require.Error(t, err)
	_, err = provider.FetchObjectDetails(context.Background(), gvk, "team-a", "shop")
	require.Error(t, err)
	_, err = provider.FetchObjectDetails(snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: "b"}), gvk, "team-a", "shop")
	require.Error(t, err)
	reg := domain.New()
	require.NoError(t, snapshot.RegisterObjectDetailsDomain(reg, provider))
	config, ok := reg.Get("object-details")
	require.True(t, ok)
	first, err := config.BuildSnapshot(ctx, "team-a:argoproj.io/v1alpha1:application:shop")
	require.NoError(t, err)
	require.Equal(t, uint64(1), first.Version)
	object.SetResourceVersion("2")
	require.NoError(t, unstructured.SetNestedField(object.Object, "Healthy", "status", "health", "status"))
	_, err = dynamic.Resource(gvk.GroupVersion().WithResource("applications")).Namespace("team-a").Update(ctx, object, metav1.UpdateOptions{})
	require.NoError(t, err)
	second, err := config.BuildSnapshot(ctx, "team-a:argoproj.io/v1alpha1:application:shop")
	require.NoError(t, err)
	require.Equal(t, uint64(2), second.Version)
	require.Equal(t, "Healthy", second.Payload.(snapshot.ObjectDetailsSnapshotPayload).Details.(*customresource.Details).Status)
	dynamic.PrependReactor("get", "applications", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: gvk.Group, Resource: "applications"}, "shop", nil)
	})
	_, err = provider.FetchObjectDetails(ctx, gvk, "team-a", "shop")
	require.Error(t, err)
}
