package backend

import "testing"

func TestSanitizeCsvFilename(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", "export.csv"},
		{"   ", "export.csv"},
		{"nodes", "nodes.csv"},
		{"nodes.csv", "nodes.csv"},
		{"Nodes.CSV", "Nodes.CSV"},
		{"a/b\\c", "a-b-c.csv"},
		{"cluster nodes", "cluster nodes.csv"},
	}
	for _, c := range cases {
		if got := sanitizeCsvFilename(c.in); got != c.want {
			t.Errorf("sanitizeCsvFilename(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
