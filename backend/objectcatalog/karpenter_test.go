package objectcatalog

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

func TestKarpenterQueryRetainsFamilyAcrossFiltersAndPages(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	rows := []Summary{
		{Ref: resourcemodel.ResourceRef{ClusterID: "a", Group: "karpenter.sh", Version: "v1", Kind: "NodePool", Resource: "nodepools", Name: "default", UID: "pool"}, Scope: ScopeCluster},
		{Ref: resourcemodel.ResourceRef{ClusterID: "a", Group: "karpenter.k8s.aws", Version: "v1beta1", Kind: "EC2NodeClass", Resource: "ec2nodeclasses", Name: "default", UID: "class"}, Scope: ScopeCluster},
		{Ref: resourcemodel.ResourceRef{ClusterID: "a", Group: "other.io", Version: "v1", Kind: "NodePool", Resource: "nodepools", Name: "other", UID: "other"}, Scope: ScopeCluster},
		{Ref: resourcemodel.ResourceRef{ClusterID: "a", Group: "karpenter.sh", Version: "v1", Kind: "Unexpected", Resource: "unexpected", Namespace: "ns", Name: "namespaced", UID: "ns"}, Scope: ScopeNamespace},
	}
	svc.publishStreamingState([]*summaryChunk{{items: rows}}, map[string]bool{"NodePool": false, "EC2NodeClass": false, "Unexpected": true}, map[string]struct{}{"ns": {}}, nil, true)
	opts := QueryOptions{ResourceFamily: "karpenter", Limit: 1}
	first := svc.Query(opts)
	require.Equal(t, 2, first.TotalItems)
	require.Equal(t, 2, first.UnfilteredTotal)
	require.Empty(t, first.Namespaces)
	require.ElementsMatch(t, []string{"karpenter.sh", "karpenter.k8s.aws"}, first.Groups)
	require.Equal(t, []Scope{ScopeCluster}, first.ResourceScopes)
	require.ElementsMatch(t, []KindInfo{{Kind: "NodePool"}, {Kind: "EC2NodeClass"}}, first.Kinds)
	require.NotEmpty(t, first.ContinueToken)
	opts.Continue = first.ContinueToken
	second := svc.Query(opts)
	require.Len(t, second.Items, 1)
	require.NotEqual(t, first.Items[0].Ref.UID, second.Items[0].Ref.UID)
	require.Empty(t, second.ContinueToken)
	opts.Continue = ""
	opts.Kinds = []string{"NodePool"}
	filtered := svc.Query(opts)
	require.Equal(t, 1, filtered.TotalItems)
	require.Equal(t, 2, filtered.UnfilteredTotal)
	require.Equal(t, "pool", filtered.Items[0].Ref.UID)
	opts.ResourceFamily = ""
	opts.Kinds = nil
	opts.Continue = first.ContinueToken
	require.True(t, svc.Query(opts).CursorInvalid)
}

func TestDiscoveredFamiliesDoNotDependOnObjectsOrListPermission(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	require.Empty(t, svc.DiscoveredResourceFamilies())
	// Discovery identity is published before RBAC filtering and collection.
	svc.identity.replaceDiscovered([]resourceDescriptor{
		builtinDescriptor("karpenter.sh", "v1", "NodePool", "nodepools", false),
		builtinDescriptor("karpenter.azure.com", "v1beta1", "AKSNodeClass", "aksnodeclasses", false),
		builtinDescriptor("other.io", "v1", "NodePool", "nodepools", false),
	})
	require.Empty(t, svc.Query(QueryOptions{}).Items)
	require.Equal(t, []string{"karpenter"}, svc.DiscoveredResourceFamilies())
	other := NewService(Dependencies{}, nil)
	require.Empty(t, other.DiscoveredResourceFamilies())
	svc.identity.replaceDiscovered(nil)
	require.Empty(t, svc.DiscoveredResourceFamilies())
}
