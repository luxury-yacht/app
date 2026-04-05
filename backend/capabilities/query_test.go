package capabilities

import (
	"testing"

	authorizationv1 "k8s.io/api/authorization/v1"
)

// TestMatchRules_SSRRRulesCanContainClusterScopedResources verifies that
// even if SSRR rules contain cluster-scoped resource rules (e.g., from
// a namespace RoleBinding referencing a ClusterRole), the rule matcher
// alone cannot prevent false positives — the caller (QueryPermissions)
// must detect cluster-scoped resources via GVR and route to SSAR.
// This test documents the design invariant: the routing guard is load-bearing.
func TestMatchRules_SSRRRulesCanContainClusterScopedResources(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"*"}, APIGroups: []string{"*"}, Resources: []string{"*"}},
	}
	// The matcher WOULD match — this is exactly why QueryPermissions
	// must NOT call MatchRules for cluster-scoped resources.
	if !MatchRules(rules, "", "nodes", "list", "", "") {
		t.Error("wildcard rule matches nodes — confirms routing guard is load-bearing")
	}
}

func TestMatchRules_NoMatchWithIncompleteRules(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"list"}, APIGroups: []string{""}, Resources: []string{"pods"}},
	}
	if MatchRules(rules, "", "pods", "delete", "", "") {
		t.Error("should not match delete when only list is granted")
	}
}

func TestMatchRules_SubresourceRequiresExplicitRule(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"*"}, APIGroups: []string{"apps"}, Resources: []string{"deployments"}},
	}
	if MatchRules(rules, "apps", "deployments", "update", "scale", "") {
		t.Error("plain 'deployments' rule should NOT match 'deployments/scale'")
	}
}

func TestMatchRules_WildcardResourceCoversSubresource(t *testing.T) {
	rules := []authorizationv1.ResourceRule{
		{Verbs: []string{"*"}, APIGroups: []string{""}, Resources: []string{"*"}},
	}
	if !MatchRules(rules, "", "pods", "get", "log", "") {
		t.Error("wildcard '*' resource should match pods/log")
	}
}
