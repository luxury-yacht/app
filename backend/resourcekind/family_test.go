package resourcekind

import "testing"

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
