package cachekeys

import "testing"

func TestBuild(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name      string
		kind      string
		namespace string
		resource  string
		want      string
	}{
		{
			name:     "ClusterScoped",
			kind:     "nodes",
			resource: "node-a",
			want:     "nodes::node-a",
		},
		{
			name:      "Namespaced",
			kind:      "deployments",
			namespace: "team-a",
			resource:  "api",
			want:      "deployments:team-a:api",
		},
		{
			name:     "EmptyName",
			kind:     "namespaces",
			resource: "",
			want:     "namespaces::",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := Build(tc.kind, tc.namespace, tc.resource)
			if got != tc.want {
				t.Fatalf("Build(%q,%q,%q) = %q, want %q", tc.kind, tc.namespace, tc.resource, got, tc.want)
			}
		})
	}
}

func TestBuildList(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name      string
		kind      string
		namespace string
		want      string
	}{
		{
			name: "ClusterScoped",
			kind: "nodes",
			want: "list:nodes",
		},
		{
			name:      "Namespaced",
			kind:      "pods",
			namespace: "team-b",
			want:      "list:pods:team-b",
		},
		{
			name:      "EmptyNamespace",
			kind:      "namespaces",
			namespace: "",
			want:      "list:namespaces",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := BuildList(tc.kind, tc.namespace)
			if got != tc.want {
				t.Fatalf("BuildList(%q,%q) = %q, want %q", tc.kind, tc.namespace, got, tc.want)
			}
		})
	}
}
