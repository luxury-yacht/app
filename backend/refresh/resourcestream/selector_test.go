package resourcestream

import (
	"encoding/json"
	"os"
	"path/filepath"
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
		{
			name:   "cluster events doorbell scope",
			domain: "cluster-events",
			scope:  "cluster",
			want:   StreamSelector{ClusterID: "c1", Domain: "cluster-events", ScopeKind: StreamScopeCluster},
		},
		{
			name:   "namespace events doorbell scope",
			domain: "namespace-events",
			scope:  "namespace:prod",
			want:   StreamSelector{ClusterID: "c1", Domain: "namespace-events", ScopeKind: StreamScopeNamespace, Namespace: "prod"},
		},
		{
			name:   "catalog doorbell scope",
			domain: "catalog",
			scope:  "",
			want:   StreamSelector{ClusterID: "c1", Domain: "catalog", ScopeKind: StreamScopeCluster},
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
		{domainPods, "workload:prod::v1:Deployment:web", "namespace:group:version:kind:name"},
		{domainNodes, "namespace:prod", "does not accept scope"},
		{"catalog", "limit=50", "does not accept scope"},
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

func TestStreamSelectorCanonicalScope(t *testing.T) {
	cases := []struct {
		domain string
		scope  string
		want   string
	}{
		{domainPods, "namespace:default", "namespace:default"},
		{domainPods, "namespace:all", "namespace:all"},
		{domainPods, "node:n1", "node:n1"},
		{domainPods, "workload:prod:apps:v1:Deployment:web", "workload:prod:apps:v1:Deployment:web"},
		{domainWorkloads, "prod", "namespace:prod"},
		{domainWorkloads, "namespace:all", "namespace:all"},
		{domainClusterRBAC, "", ""},
		{domainNodes, "", ""},
		{"cluster-events", "cluster", ""},
		{"namespace-events", "prod", "namespace:prod"},
		{"catalog", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.domain+"/"+tc.scope, func(t *testing.T) {
			selector, err := ParseStreamSelector("c1", tc.domain, tc.scope)
			require.NoError(t, err)
			require.Equal(t, tc.want, selector.CanonicalScope())
		})
	}
}

func TestStreamSelectorMatchesAuthoredScopeExamples(t *testing.T) {
	examples := loadScopeExamples(t)
	domainByKind := map[string]string{
		"pod":       domainPods,
		"namespace": domainWorkloads,
		"cluster":   domainNodes,
	}

	for kind, cases := range examples {
		domainName := domainByKind[kind]
		require.NotEmptyf(t, domainName, "scopeExamples.%s needs a representative domain", kind)

		for _, tc := range cases.Valid {
			t.Run(kind+"/valid/"+tc.Scope, func(t *testing.T) {
				selector, err := ParseStreamSelector("c1", domainName, tc.Scope)
				require.NoError(t, err)
				require.Equal(t, tc.Canonical, selector.CanonicalScope())
			})
		}

		for _, tc := range cases.Invalid {
			t.Run(kind+"/invalid/"+tc.Scope, func(t *testing.T) {
				_, err := ParseStreamSelector("c1", domainName, tc.Scope)
				require.Error(t, err)
				require.Contains(t, err.Error(), tc.ErrorContains)
			})
		}
	}
}

type streamScopeExamples map[string]struct {
	Valid   []streamScopeValidExample   `json:"valid"`
	Invalid []streamScopeInvalidExample `json:"invalid"`
}

type streamScopeValidExample struct {
	Scope     string `json:"scope"`
	Canonical string `json:"canonical"`
}

type streamScopeInvalidExample struct {
	Scope         string `json:"scope"`
	ErrorContains string `json:"errorContains"`
}

func loadScopeExamples(t *testing.T) streamScopeExamples {
	t.Helper()
	path := filepath.Join("..", "domain", "refresh-domain-contract.json")
	raw, err := os.ReadFile(path)
	require.NoError(t, err)

	var contract struct {
		ResourceStream struct {
			ScopeExamples streamScopeExamples `json:"scopeExamples"`
		} `json:"resourceStream"`
	}
	require.NoError(t, json.Unmarshal(raw, &contract))
	require.NotEmpty(t, contract.ResourceStream.ScopeExamples)
	return contract.ResourceStream.ScopeExamples
}
