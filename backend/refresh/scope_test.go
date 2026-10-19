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

// Object details, YAML, events, and logs decode their scope with
// ParseObjectScope directly, so it must return the literal object name.
func TestParseObjectScopeDecodesEscapedName(t *testing.T) {
	identity, err := ParseObjectScope("cluster-a|team-a:rbac.authorization.k8s.io/v1:Role:reader%3Fteam")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if identity.Name != "reader?team" {
		t.Fatalf("expected the literal name reader?team, got %q", identity.Name)
	}
}

func TestParseObjectScopeHandlesClusterToken(t *testing.T) {
	identity, err := ParseObjectScope("__cluster__:/v1:Node:n1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if identity.Namespace != "" {
		t.Fatalf("expected empty namespace, got %q", identity.Namespace)
	}
	if identity.GVK.Kind != "Node" {
		t.Fatalf("expected kind Node, got %q", identity.GVK.Kind)
	}
	if identity.GVK.Group != "" || identity.GVK.Version != "v1" {
		t.Fatalf("expected core/v1 Node GVK, got %#v", identity.GVK)
	}
}

func TestParseObjectScopeRejectsKindOnlyScope(t *testing.T) {
	if _, err := ParseObjectScope("default:Pod:web"); err == nil {
		t.Fatal("expected kind-only object scope to be rejected")
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
