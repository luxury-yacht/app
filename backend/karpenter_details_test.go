package backend

import (
	"context"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	authorizationv1 "k8s.io/api/authorization/v1"
	"testing"
	"time"

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

func TestKarpenterDetailsUseDiscoveredVersionAndCluster(t *testing.T) {
	gvk := schema.GroupVersionKind{Group: "karpenter.sh", Version: "v1beta1", Kind: "NodePool"}
	client := fake.NewClientset()
	client.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{GroupVersion: gvk.GroupVersion().String(), APIResources: []metav1.APIResource{{Name: "nodepools", Kind: "NodePool", Verbs: metav1.Verbs{"list", "get"}}}}}
	object := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "karpenter.sh/v1beta1", "kind": "NodePool", "metadata": map[string]any{"name": "pool"}, "spec": map[string]any{"weight": int64(30)}}}
	dynamic := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), object)
	gateway := newObjectDetailResourceGateway(map[string]*clusterClients{"a": {meta: ClusterMeta{ID: "a", Name: "a"}, client: client, dynamicClient: dynamic}})
	gateway.responseCache = newResponseCache(time.Minute, 20)
	client.PrependReactor("create", "selfsubjectaccessreviews", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, &authorizationv1.SelfSubjectAccessReview{Status: authorizationv1.SubjectAccessReviewStatus{Allowed: true}}, nil
	})
	provider := gateway.objectDetailProvider()
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: "a"})
	raw, err := provider.FetchObjectDetails(ctx, gvk, "", "pool")
	require.NoError(t, err)
	detail := raw.(*customresource.Details)
	require.Equal(t, "a", detail.Ref.ClusterID)
	require.Equal(t, "v1beta1", detail.Ref.Version)
	require.Equal(t, int64(30), *detail.Karpenter.Weight)
	require.Equal(t, "nodepools", detail.Ref.Resource)
	lowerCaseKind := gvk
	lowerCaseKind.Kind = "nodepool"
	lowerRaw, err := provider.FetchObjectDetails(ctx, lowerCaseKind, "", "pool")
	require.NoError(t, err)
	lowerDetail := lowerRaw.(*customresource.Details)
	require.Equal(t, "NodePool", lowerDetail.Kind, "panel scopes normalize kind case; projection must preserve the API object's identity")
	require.Equal(t, int64(30), *lowerDetail.Karpenter.Weight)

	_, err = provider.FetchObjectDetails(context.Background(), gvk, "", "pool")
	require.Error(t, err)
	_, err = provider.FetchObjectDetails(snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{ClusterID: "b"}), gvk, "", "pool")
	require.Error(t, err)
	reg := domain.New()
	require.NoError(t, snapshot.RegisterObjectDetailsDomain(reg, provider))
	config, ok := reg.Get("object-details")
	require.True(t, ok)
	object.SetResourceVersion("1")
	_, err = dynamic.Resource(gvk.GroupVersion().WithResource("nodepools")).Update(ctx, object, metav1.UpdateOptions{})
	require.NoError(t, err)
	first, err := config.BuildSnapshot(ctx, "__cluster__:karpenter.sh/v1beta1:nodepool:pool")
	require.NoError(t, err)
	require.Equal(t, uint64(1), first.Version)
	object.SetResourceVersion("2")
	require.NoError(t, unstructured.SetNestedField(object.Object, int64(40), "spec", "weight"))
	_, err = dynamic.Resource(gvk.GroupVersion().WithResource("nodepools")).Update(ctx, object, metav1.UpdateOptions{})
	require.NoError(t, err)
	second, err := config.BuildSnapshot(ctx, "__cluster__:karpenter.sh/v1beta1:nodepool:pool")
	require.NoError(t, err)
	require.Equal(t, int64(40), *second.Payload.(snapshot.ObjectDetailsSnapshotPayload).Details.(*customresource.Details).Karpenter.Weight)
	require.Equal(t, uint64(2), second.Version, "fresh detail must not retain a cached source-version ETag")
	dynamic.PrependReactor("get", "nodepools", func(ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "karpenter.sh", Resource: "nodepools"}, "pool", nil)
	})
	_, err = provider.FetchObjectDetails(ctx, gvk, "", "pool")
	require.Error(t, err, "permission denial must not be bypassed by a cached enrichment")
}
