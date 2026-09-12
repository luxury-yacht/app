package objectcatalog

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestArgoCDDiscoveryAndQueryRemainNamespaced(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	svc.identity.replaceDiscovered([]resourceDescriptor{
		builtinDescriptor("argoproj.io", "v1alpha1", "Application", "applications", true),
		builtinDescriptor("argoproj.io", "v1alpha1", "AppProject", "appprojects", true),
		builtinDescriptor("argoproj.io", "v1alpha1", "ClusterWorkflowTemplate", "clusterworkflowtemplates", false),
	})
	require.Equal(t, []string{"argocd"}, svc.DiscoveredResourceFamilies())
	require.Empty(t, svc.Query(QueryOptions{}).Items)
	var rows []Summary
	for _, input := range []struct{ group, kind, ns, name string }{
		{"argoproj.io", "Application", "team-a", "shop"}, {"argoproj.io", "AppProject", "team-a", "production"},
		{"argoproj.io", "Application", "team-b", "shop"}, {"argoproj.io", "Workflow", "team-a", "run"},
		{"other.io", "Application", "team-a", "other"},
	} {
		rows = append(rows, Summary{Ref: resourcemodel.ResourceRef{ClusterID: "a", Group: input.group, Version: "v1alpha1", Kind: input.kind, Resource: input.kind + "s", Namespace: input.ns, Name: input.name, UID: input.ns + input.name}, Scope: ScopeNamespace})
	}
	svc.publishStreamingState([]*summaryChunk{{items: rows}}, map[string]bool{"Application": true, "AppProject": true, "Workflow": true}, map[string]struct{}{"team-a": {}, "team-b": {}}, nil, true)
	opts := QueryOptions{ResourceFamily: "argocd", Scope: ScopeNamespace, ScopeNamespaces: []string{"team-a"}, Limit: 1}
	first := svc.Query(opts)
	require.Equal(t, 2, first.TotalItems)
	require.Equal(t, 2, first.UnfilteredTotal)
	require.ElementsMatch(t, []KindInfo{{Kind: "Application", Namespaced: true}, {Kind: "AppProject", Namespaced: true}}, first.Kinds)
	require.Equal(t, []string{"argoproj.io"}, first.Groups)
	require.Equal(t, "team-a", first.Items[0].Ref.Namespace)
	opts.Continue = first.ContinueToken
	second := svc.Query(opts)
	require.Len(t, second.Items, 1)
	require.NotEqual(t, first.Items[0].Ref.UID, second.Items[0].Ref.UID)
	opts.Continue = ""
	opts.ScopeNamespaces = nil
	require.Equal(t, 3, svc.Query(opts).TotalItems)
	opts.Scope = ScopeCluster
	require.Empty(t, svc.Query(opts).Items)
	svc.identity.replaceDiscovered([]resourceDescriptor{builtinDescriptor("argoproj.io", "v1alpha1", "Workflow", "workflows", true)})
	require.Empty(t, svc.DiscoveredResourceFamilies())
}
