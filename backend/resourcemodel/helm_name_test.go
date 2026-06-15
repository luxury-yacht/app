package resourcemodel

import "testing"

func TestHelmReleaseName(t *testing.T) {
	cases := map[string]string{
		"sh.helm.release.v1.myrel.v3": "myrel",
		"sh.helm.release.v1.foo":      "foo",   // prefix but no .v revision suffix
		"plain":                       "plain", // no prefix -> unchanged
	}
	for in, want := range cases {
		if got := HelmReleaseName(in); got != want {
			t.Fatalf("HelmReleaseName(%q) = %q, want %q", in, got, want)
		}
	}
}
