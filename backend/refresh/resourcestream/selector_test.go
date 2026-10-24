package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
)

func TestParseStreamSelectorRequiresClusterIdentity(t *testing.T) {
	for _, clusterID := range []string{"", " "} {
		_, err := ParseStreamSelector(clusterID, domainPods, "namespace:default")
		require.Error(t, err)
	}
}

func TestCustomTablesSubscribeThroughCatalogOnly(t *testing.T) {
	for _, legacy := range []struct{ domain, scope string }{
		{"namespace-custom", "namespace:default"},
		{"cluster-custom", ""},
	} {
		_, err := ParseStreamSelector("c1", legacy.domain, legacy.scope)
		require.Error(t, err, "retired full-list domains must not accept subscriptions")
	}
	selector, err := ParseStreamSelector("c1", "catalog", "")
	require.NoError(t, err)
	require.Equal(t, refresh.ClusterSelector(), selector.Selector)
}

func TestParseStreamSelectorRoundTrips(t *testing.T) {
	web := refresh.ObjectScopeIdentity{
		Namespace: "prod",
		GVK:       schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"},
		Name:      "web",
	}
	cases := []struct {
		name     string
		domain   string
		scope    string
		selector refresh.ScopeSelector
	}{
		{"pods namespace scope", domainPods, "namespace:default", refresh.NamespaceSelector("default")},
		{"pods namespace all", domainPods, "namespace:all", refresh.AllNamespacesSelector()},
		{"pods node scope", domainPods, "node:worker-1", refresh.NodeSelector("worker-1")},
		{"pods workload scope full GVK", domainPods, "workload:prod:apps:v1:Deployment:web", refresh.WorkloadSelector(web)},
		{"namespace scope namespace-workloads", domainWorkloads, "namespace:prod", refresh.NamespaceSelector("prod")},
		{"cluster scope nodes", domainNodes, "", refresh.ClusterSelector()},
		{"cluster scope cluster-config", domainClusterConfig, "", refresh.ClusterSelector()},
		{"cluster events doorbell scope", "cluster-events", "", refresh.ClusterSelector()},
		{"namespace events doorbell scope", "namespace-events", "namespace:prod", refresh.NamespaceSelector("prod")},
		{"catalog doorbell scope", "catalog", "", refresh.ClusterSelector()},
		{"object events doorbell scope", domainObjectEvents, "prod:apps/v1:Deployment:web", refresh.ObjectSelector(web)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseStreamSelector("c1", tc.domain, tc.scope)
			require.NoError(t, err)
			require.Equal(t, StreamSelector{ClusterID: "c1", Domain: tc.domain, Selector: tc.selector}, got)
			require.Equal(t, tc.scope, got.CanonicalScope())
		})
	}
}

func TestParseStreamSelectorRejectsNonCanonicalScopes(t *testing.T) {
	cases := []struct {
		domain string
		scope  string
	}{
		{domainPods, ""},
		{domainPods, "node:"},
		{domainPods, "workload:prod:apps"},
		{domainPods, "workload:prod::v1:Deployment:web"},
		{domainPods, "namespace:*"},
		{domainPods, "namespace:all?limit=50"},
		{domainWorkloads, "prod"},
		{domainNodes, "namespace:prod"},
		{domainNodes, "cluster"},
		{"catalog", "limit=50"},
		{"unknown-domain", "anything"},
	}
	for _, tc := range cases {
		t.Run(tc.domain+"/"+tc.scope, func(t *testing.T) {
			_, err := ParseStreamSelector("c1", tc.domain, tc.scope)
			require.Error(t, err)
		})
	}
}
