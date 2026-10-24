package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseNamespaceSnapshotScope(t *testing.T) {
	const required = "namespace scope is required"

	tests := []struct {
		name          string
		scope         string
		namespace     string
		allNamespaces bool
		canonical     string
	}{
		{name: "namespace", scope: "namespace:default", namespace: "default", canonical: "cluster-a|namespace:default"},
		{name: "all namespaces", scope: "namespace:all", allNamespaces: true, canonical: "cluster-a|namespace:all"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseNamespaceSnapshotScope(namespaceWorkloadsDomainName, "cluster-a", tc.scope, required)
			require.NoError(t, err)
			require.Equal(t, NamespaceSnapshotScope{
				ClusterID:      "cluster-a",
				Namespace:      tc.namespace,
				AllNamespaces:  tc.allNamespaces,
				CanonicalScope: tc.canonical,
			}, got)
		})
	}
}

func TestParseNamespaceSnapshotScopeRejectsNonCanonicalScopes(t *testing.T) {
	const required = "namespace scope is required"

	_, err := parseNamespaceSnapshotScope(namespaceWorkloadsDomainName, "cluster-a", "", required)
	require.EqualError(t, err, required)

	// The retired lenient forms no producer emits any more.
	for _, scope := range []string{"default", "namespace:", "namespace::default", "namespace:*", "node:worker-1"} {
		t.Run(scope, func(t *testing.T) {
			_, err := parseNamespaceSnapshotScope(namespaceWorkloadsDomainName, "cluster-a", scope, required)
			require.Error(t, err)
		})
	}
}
