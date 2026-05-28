package snapshot

import "testing"

func TestParseNamespaceSnapshotScope(t *testing.T) {
	const required = "namespace scope is required"

	tests := []struct {
		name          string
		scope         string
		clusterID     string
		namespace     string
		allNamespaces bool
		canonical     string
	}{
		{
			name:      "bare namespace",
			scope:     "default",
			namespace: "default",
			canonical: "namespace:default",
		},
		{
			name:      "prefixed namespace",
			scope:     "namespace:default",
			namespace: "default",
			canonical: "namespace:default",
		},
		{
			name:      "extra namespace separator",
			scope:     "namespace::default",
			namespace: "default",
			canonical: "namespace:default",
		},
		{
			name:      "namespace containing separator",
			scope:     "namespace:team:api",
			namespace: "team:api",
			canonical: "namespace:team:api",
		},
		{
			name:          "all namespace wildcard",
			scope:         "namespace:*",
			allNamespaces: true,
			canonical:     "namespace:all",
		},
		{
			name:          "all namespace word",
			scope:         "namespace:all",
			allNamespaces: true,
			canonical:     "namespace:all",
		},
		{
			name:      "cluster prefix",
			scope:     "cluster-a|namespace:default",
			clusterID: "cluster-a",
			namespace: "default",
			canonical: "cluster-a|namespace:default",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseNamespaceSnapshotScope(tc.scope, required)
			if err != nil {
				t.Fatalf("parseNamespaceSnapshotScope() error = %v", err)
			}
			if got.ClusterID != tc.clusterID {
				t.Fatalf("ClusterID = %q, want %q", got.ClusterID, tc.clusterID)
			}
			if got.Namespace != tc.namespace {
				t.Fatalf("Namespace = %q, want %q", got.Namespace, tc.namespace)
			}
			if got.AllNamespaces != tc.allNamespaces {
				t.Fatalf("AllNamespaces = %v, want %v", got.AllNamespaces, tc.allNamespaces)
			}
			if got.CanonicalScope != tc.canonical {
				t.Fatalf("CanonicalScope = %q, want %q", got.CanonicalScope, tc.canonical)
			}
		})
	}
}

func TestParseNamespaceSnapshotScopeRequiresScope(t *testing.T) {
	const required = "namespace scope is required"

	for _, scope := range []string{"", "   ", "namespace:", "cluster-a|namespace:"} {
		t.Run(scope, func(t *testing.T) {
			if _, err := parseNamespaceSnapshotScope(scope, required); err == nil || err.Error() != required {
				t.Fatalf("error = %v, want %q", err, required)
			}
		})
	}
}
