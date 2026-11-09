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

// The frontend builds the target's link from this apiVersion, and resolves a built-in
// kind itself when it is empty. A group with no version would give it nothing to use.
func TestScaleTargetWithoutAVersionKeepsItsGroupButReportsNoAPIVersion(t *testing.T) {
	link := scaleTargetLink("cluster-a", "team-a", "apps/", "Deployment", "web")

	if link.Ref != nil || link.Display == nil || link.Display.Group != "apps" {
		t.Fatalf("the group is needed to match the workload: %#v", link)
	}
	if got := scaleTargetAPIVersion(link); got != "" {
		t.Fatalf("got apiVersion %q, want none", got)
	}
}
