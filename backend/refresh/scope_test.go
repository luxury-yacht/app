package refresh

import "testing"

func TestJoinClusterScopePreservesEmptyScope(t *testing.T) {
	joined := JoinClusterScope("cluster-a", "")
	if joined != "cluster-a|" {
		t.Fatalf("expected cluster scope with delimiter, got %q", joined)
	}

	clusterID, scope := SplitClusterScope(joined)
	if clusterID != "cluster-a" {
		t.Fatalf("expected cluster id cluster-a, got %q", clusterID)
	}
	if scope != "" {
		t.Fatalf("expected empty scope, got %q", scope)
	}
}
