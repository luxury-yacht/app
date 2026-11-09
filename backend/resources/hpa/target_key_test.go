package hpa

import "testing"

// The HPA controller finds its target by group and kind and ignores the version, so
// every check of whether a workload has an HPA must agree on that.
func TestTargetKeyMatchesAcrossVersionsButNotAcrossIdentity(t *testing.T) {
	base := TargetKey("team-a", "apps", "Deployment", "web")
	if TargetKey(" team-a ", " apps ", " Deployment ", " web ") != base {
		t.Fatal("surrounding space must not change the target")
	}
	for name, other := range map[string]string{
		"namespace": TargetKey("team-b", "apps", "Deployment", "web"),
		"group":     TargetKey("team-a", "example.com", "Deployment", "web"),
		"kind":      TargetKey("team-a", "apps", "StatefulSet", "web"),
		"name":      TargetKey("team-a", "apps", "Deployment", "api"),
	} {
		if other == base {
			t.Fatalf("a different %s must be a different target", name)
		}
	}
}
