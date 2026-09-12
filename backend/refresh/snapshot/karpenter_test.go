package snapshot

import (
	"context"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
	"testing"
)

func TestCatalogResourceFamilyScope(t *testing.T) {
	opts, err := parseBrowseScope("cluster-a|resourceFamily=karpenter&limit=25")
	require.NoError(t, err)
	require.Equal(t, "karpenter", opts.toQueryOptions().ResourceFamily)
	argo, err := parseBrowseScope("cluster-a|resourceFamily=argocd&resourceScope=namespace&scopeNamespace=team-a")
	require.NoError(t, err)
	require.Equal(t, "argocd", argo.toQueryOptions().ResourceFamily)
	require.Equal(t, []string{"team-a"}, argo.toQueryOptions().ScopeNamespaces)
	_, err = parseBrowseScope("cluster-a|resourceFamily=unknown")
	require.Error(t, err)
}

func TestCatalogSnapshotPublishesDiscoveredKarpenterWithoutRows(t *testing.T) {
	client := fake.NewClientset()
	client.Discovery().(*fakediscovery.FakeDiscovery).Resources = []*metav1.APIResourceList{{GroupVersion: "karpenter.sh/v1", APIResources: []metav1.APIResource{{Name: "nodepools", Kind: "NodePool", Verbs: metav1.Verbs{"list", "get"}}}}}
	svc := objectcatalog.NewService(objectcatalog.Dependencies{Common: common.Dependencies{KubernetesClient: client}, ClusterID: "a"}, nil)
	_, found, err := svc.ResolveResourceForGVK(context.Background(), schema.GroupVersionKind{Group: "karpenter.sh", Version: "v1", Kind: "NodePool"})
	require.NoError(t, err)
	require.True(t, found)
	adapter := newCatalogRefreshAdapter(svc, ClusterMeta{ClusterID: "a"}, nil)
	snap := adapter.BuildSnapshot("catalog", "limit=1", browseQueryOptions{Limit: 1})
	payload := snap.Payload.(CatalogSnapshot)
	require.Equal(t, "a", payload.ClusterID)
	require.Empty(t, payload.Items)
	require.Equal(t, []string{"karpenter"}, payload.ResourceFamilies)
	other := newCatalogRefreshAdapter(objectcatalog.NewService(objectcatalog.Dependencies{}, nil), ClusterMeta{ClusterID: "b"}, nil)
	require.Empty(t, other.BuildSnapshot("catalog", "limit=1", browseQueryOptions{Limit: 1}).Payload.(CatalogSnapshot).ResourceFamilies)
}
