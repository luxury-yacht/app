package resourcekind

import (
	"strings"
	"testing"
)

func TestFamilyRulesMatchCatalogClassification(t *testing.T) {
	for _, rule := range FamilyRules() {
		if !IsResourceFamily(rule.Family) {
			t.Fatalf("unknown family in generated policy: %q", rule.Family)
		}
		for kind, namespaced := range rule.Kinds {
			if got := FamilyForResource(rule.Group, strings.ToUpper(kind), namespaced); got != rule.Family {
				t.Errorf("%s/%s classifies as %q instead of %q", rule.Group, kind, got, rule.Family)
			}
			if got := FamilyForResource(rule.Group, kind, !namespaced); got != "" {
				t.Errorf("wrong scope accepted for %s/%s", rule.Group, kind)
			}
		}
		if rule.GroupPrefix != "" {
			if got := FamilyForResource(rule.GroupPrefix+"provider", "NewClass", false); got != rule.Family {
				t.Errorf("prefix policy differs from catalog classification: %q", got)
			}
		}
	}
	if IsResourceFamily("unrelated") {
		t.Fatal("unknown family accepted")
	}
}

func TestKarpenterFamilyRequiresDiscoveredClusterScope(t *testing.T) {
	for _, test := range []struct {
		group      string
		namespaced bool
		want       string
	}{
		{"karpenter.sh", false, KarpenterFamily},
		{"karpenter.k8s.aws", false, KarpenterFamily},
		{"karpenter.azure.com", false, KarpenterFamily},
		{"karpenter.sh", true, ""},
		{"other.io", false, ""},
		{"karpenter-example.io", false, ""},
	} {
		if got := FamilyForResource(test.group, "", test.namespaced); got != test.want {
			t.Errorf("FamilyForResource(%q, %t) = %q, want %q", test.group, test.namespaced, got, test.want)
		}
	}
}

func TestArgoCDFamilyDoesNotIncludeOtherArgoProjects(t *testing.T) {
	for _, kind := range []string{"Application", "ApplicationSet", "AppProject", "application"} {
		if got := FamilyForResource("argoproj.io", kind, true); got != "argocd" {
			t.Errorf("expected Argo CD family for %s, got %q", kind, got)
		}
	}
	for _, input := range []struct {
		group, kind string
		namespaced  bool
	}{
		{"argoproj.io", "Workflow", true}, {"argoproj.io", "ClusterWorkflowTemplate", false},
		{"argoproj.io", "Rollout", true}, {"other.io", "Application", true},
		{"argoproj.io", "Application", false},
	} {
		if got := FamilyForResource(input.group, input.kind, input.namespaced); got != "" {
			t.Errorf("unexpected family %q for %+v", got, input)
		}
	}
}
