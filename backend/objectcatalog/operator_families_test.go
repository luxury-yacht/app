package objectcatalog

import (
	"encoding/json"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
)

func TestOperatorFamilyQueriesKeepScopeAndRejectKindCollisions(t *testing.T) {
	for _, test := range []struct{ family, group, kind, resource string }{
		{"cert-manager", "cert-manager.io", "Certificate", "certificates"},
		{"external-secrets", "external-secrets.io", "ExternalSecret", "externalsecrets"},
		{"prometheus", "monitoring.coreos.com", "ServiceMonitor", "servicemonitors"},
	} {
		t.Run(test.family, func(t *testing.T) {
			require.Equal(t, test.family, resourcekind.FamilyForResource(test.group, test.kind, true))
			require.Empty(t, resourcekind.FamilyForResource("unrelated.io", test.kind, true))
			require.Empty(t, resourcekind.FamilyForResource(test.group, test.kind, false))
			svc := NewService(Dependencies{}, nil)
			var rows []Summary
			for _, ns := range []string{"team-a", "team-b"} {
				rows = append(rows, Summary{Ref: resourcemodel.ResourceRef{ClusterID: "a", Group: test.group, Version: "v1beta1", Kind: test.kind, Resource: test.resource, Namespace: ns, Name: "example", UID: ns}, Scope: ScopeNamespace})
			}
			other := rows[0]
			other.Ref.Group, other.Ref.UID = "unrelated.io", "collision"
			rows = append(rows, other)
			svc.publishStreamingState([]*summaryChunk{{items: rows}}, map[string]bool{test.kind: true}, map[string]struct{}{"team-a": {}, "team-b": {}}, nil, true)
			opts := QueryOptions{ResourceFamily: test.family, Scope: ScopeNamespace, Limit: 1}
			first := svc.Query(opts)
			require.Equal(t, 2, first.TotalItems)
			require.Equal(t, []string{test.group}, first.Groups)
			opts.Continue = first.ContinueToken
			second := svc.Query(opts)
			require.Len(t, second.Items, 1)
			require.NotEqual(t, first.Items[0].Ref.UID, second.Items[0].Ref.UID)
			opts.Continue, opts.ScopeNamespaces = "", []string{"team-a"}
			require.Equal(t, 1, svc.Query(opts).UnfilteredTotal)
			opts.Scope, opts.ScopeNamespaces = ScopeCluster, nil
			require.Empty(t, svc.Query(opts).Items)
		})
	}
}

func TestDiscoveredFamilyScopesDoNotRequireResourceInstances(t *testing.T) {
	svc := NewService(Dependencies{}, nil)
	svc.identity.replaceDiscovered([]Descriptor{
		builtinDescriptor("cert-manager.io", "v1", "ClusterIssuer", "clusterissuers", false),
		builtinDescriptor("external-secrets.io", "v1", "SecretStore", "secretstores", true),
		builtinDescriptor("monitoring.coreos.com", "v1", "Prometheus", "prometheuses", true),
	})
	encoded, err := json.Marshal(svc.DiscoveredResourceFamilies())
	require.NoError(t, err)
	var scopes struct {
		Cluster    []string `json:"cluster"`
		Namespaced []string `json:"namespaced"`
	}
	require.NoError(t, json.Unmarshal(encoded, &scopes))
	require.Equal(t, []string{"cert-manager"}, scopes.Cluster)
	require.Equal(t, []string{"external-secrets", "prometheus"}, scopes.Namespaced)
	require.Empty(t, svc.Query(QueryOptions{}).Items)
	svc.identity.replaceDiscovered(nil)
	empty, err := json.Marshal(svc.DiscoveredResourceFamilies())
	require.NoError(t, err)
	scopes.Cluster, scopes.Namespaced = nil, nil
	require.NoError(t, json.Unmarshal(empty, &scopes))
	require.Empty(t, scopes.Cluster)
	require.Empty(t, scopes.Namespaced)
}
