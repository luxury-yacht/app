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
		if got := FamilyForResource(test.group, test.namespaced); got != test.want {
			t.Errorf("FamilyForResource(%q, %t) = %q, want %q", test.group, test.namespaced, got, test.want)
		}
	}
}
