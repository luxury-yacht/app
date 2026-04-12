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

func TestParseObjectScopeSupportsGVK(t *testing.T) {
	identity, err := ParseObjectScope("cluster-a|default:apps/v1:deployment:web")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if identity.Namespace != "default" {
		t.Fatalf("expected namespace default, got %q", identity.Namespace)
	}
	if identity.GVK.Group != "apps" || identity.GVK.Version != "v1" || identity.GVK.Kind != "deployment" {
		t.Fatalf("unexpected gvk: %#v", identity.GVK)
	}
	if identity.Name != "web" {
		t.Fatalf("expected name web, got %q", identity.Name)
	}
}

func TestParseObjectScopeHandlesClusterToken(t *testing.T) {
	identity, err := ParseObjectScope("__cluster__:Node:n1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if identity.Namespace != "" {
		t.Fatalf("expected empty namespace, got %q", identity.Namespace)
	}
	if identity.GVK.Kind != "Node" {
		t.Fatalf("expected kind Node, got %q", identity.GVK.Kind)
	}
}

func TestParseObjectScopeKeepsCollidingKindsDistinctByGroup(t *testing.T) {
	first, err := ParseObjectScope("default:rds.services.k8s.aws/v1alpha1:DBInstance:orders")
	if err != nil {
		t.Fatalf("unexpected error parsing first scope: %v", err)
	}
	second, err := ParseObjectScope("default:documentdb.services.k8s.aws/v1alpha1:DBInstance:orders")
	if err != nil {
		t.Fatalf("unexpected error parsing second scope: %v", err)
	}

	if first.GVK.Kind != second.GVK.Kind {
		t.Fatalf("expected colliding kinds to match, got %q and %q", first.GVK.Kind, second.GVK.Kind)
	}
	if first.GVK.Group == second.GVK.Group {
		t.Fatalf("expected groups to differ, got %q", first.GVK.Group)
	}
}
