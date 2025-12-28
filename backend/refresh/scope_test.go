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

func TestSplitClusterScopeListReturnsIDsAndScope(t *testing.T) {
	ids, scope := SplitClusterScopeList("cluster-a,cluster-b|namespace:default")
	if len(ids) != 2 || ids[0] != "cluster-a" || ids[1] != "cluster-b" {
		t.Fatalf("unexpected cluster ids: %#v", ids)
	}
	if scope != "namespace:default" {
		t.Fatalf("unexpected scope %q", scope)
	}
}

func TestSplitClusterScopeListHandlesPrefixedSelectors(t *testing.T) {
	ids, scope := SplitClusterScopeList("clusters=cluster-a, cluster-a , cluster-b|")
	if len(ids) != 2 || ids[0] != "cluster-a" || ids[1] != "cluster-b" {
		t.Fatalf("unexpected cluster ids: %#v", ids)
	}
	if scope != "" {
		t.Fatalf("expected empty scope, got %q", scope)
	}
}
