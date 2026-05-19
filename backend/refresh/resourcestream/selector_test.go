package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseStreamSelectorRoundTrips(t *testing.T) {
	cases := []struct {
		name   string
		domain string
		scope  string
		want   StreamSelector
	}{
		{
			name:   "pods namespace scope",
			domain: domainPods,
			scope:  "namespace:default",
			want:   StreamSelector{ClusterID: "c1", Domain: domainPods, ScopeKind: StreamScopeNamespace, Namespace: "default"},
		},
		{
			name:   "pods namespace all",
			domain: domainPods,
			scope:  "namespace:all",
			want:   StreamSelector{ClusterID: "c1", Domain: domainPods, ScopeKind: StreamScopeAllNamespace},
		},
		{
			name:   "pods node scope",
			domain: domainPods,
			scope:  "node:worker-1",
			want:   StreamSelector{ClusterID: "c1", Domain: domainPods, ScopeKind: StreamScopeNode, Node: "worker-1"},
		},
		{
			name:   "pods workload scope full GVK",
			domain: domainPods,
			scope:  "workload:prod:apps:v1:Deployment:web",
			want: StreamSelector{
				ClusterID: "c1",
				Domain:    domainPods,
				ScopeKind: StreamScopeWorkload,
				Workload: &WorkloadSelector{
					Namespace: "prod",
					Group:     "apps",
					Version:   "v1",
					Kind:      "Deployment",
					Name:      "web",
				},
			},
		},
		{
			name:   "namespace scope namespace-workloads",
			domain: domainWorkloads,
			scope:  "namespace:prod",
			want:   StreamSelector{ClusterID: "c1", Domain: domainWorkloads, ScopeKind: StreamScopeNamespace, Namespace: "prod"},
		},
		{
			name:   "cluster scope nodes",
			domain: domainNodes,
			scope:  "",
			want:   StreamSelector{ClusterID: "c1", Domain: domainNodes, ScopeKind: StreamScopeCluster},
		},
		{
			name:   "cluster scope cluster-config",
			domain: domainClusterConfig,
			scope:  "cluster",
			want:   StreamSelector{ClusterID: "c1", Domain: domainClusterConfig, ScopeKind: StreamScopeCluster},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseStreamSelector("c1", tc.domain, tc.scope)
			require.NoError(t, err)
			require.Equal(t, tc.want, got)

			// Round-trip: typed -> string -> typed must be equal.
			reparsed, err := ParseStreamSelector("c1", tc.domain, got.String())
			require.NoError(t, err)
			require.Equal(t, got, reparsed, "round-trip mismatch")
		})
	}
}

func TestParseStreamSelectorRejectsInvalid(t *testing.T) {
	cases := []struct {
		domain string
		scope  string
		errsub string
	}{
		{domainPods, "", "scope is required"},
		{domainPods, "node:", "node scope is required"},
		{domainPods, "workload:prod:apps", "namespace:group:version:kind:name"},
		{domainNodes, "namespace:prod", "does not accept scope"},
		{"unknown-domain", "anything", "unsupported resource stream domain"},
	}
	for _, tc := range cases {
		t.Run(tc.domain+"/"+tc.scope, func(t *testing.T) {
			_, err := ParseStreamSelector("c1", tc.domain, tc.scope)
			require.Error(t, err)
			require.Contains(t, err.Error(), tc.errsub)
		})
	}
}

// TestNormalizeScopeAgreesWithTypedSelector ensures the legacy scope
// string normalizer (still used at the WebSocket boundary) emits the
// same canonical form as the typed StreamSelector. The two
// representations must stay aligned until normalizeScopeForDomain is
// retired in favor of selector-aware routing.
func TestNormalizeScopeAgreesWithTypedSelector(t *testing.T) {
	cases := []struct {
		domain string
		scope  string
	}{
		{domainPods, "namespace:default"},
		{domainPods, "namespace:all"},
		{domainPods, "node:n1"},
		{domainPods, "workload:prod:apps:v1:Deployment:web"},
		{domainWorkloads, "namespace:prod"},
		{domainWorkloads, "namespace:all"},
		{domainClusterRBAC, ""},
		{domainNodes, ""},
	}
	for _, tc := range cases {
		t.Run(tc.domain+"/"+tc.scope, func(t *testing.T) {
			legacy, legacyErr := normalizeScopeForDomain(tc.domain, tc.scope)
			require.NoError(t, legacyErr)
			typed, typedErr := ParseStreamSelector("c1", tc.domain, tc.scope)
			require.NoError(t, typedErr)
			require.Equal(t, legacy, typed.String(), "legacy normalized scope must equal typed selector encoding")
		})
	}
}
