package backend

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The atomic write must produce a user-readable file (CreateTemp's 0600 would
// make exports owner-only) with the full content durably written.
func TestWriteCSVFileAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "export.csv")

	info, err := writeCSVFileAtomically(path, "a,b\n1,2\n")
	if err != nil {
		t.Fatalf("writeCSVFileAtomically failed: %v", err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back failed: %v", err)
	}
	if string(content) != "a,b\n1,2\n" {
		t.Fatalf("unexpected content %q", content)
	}
	if info.Size() != int64(len("a,b\n1,2\n")) {
		t.Fatalf("unexpected reported size %d", info.Size())
	}
	if runtime.GOOS != "windows" {
		stat, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat failed: %v", err)
		}
		if stat.Mode().Perm() != 0o644 {
			t.Fatalf("expected 0644 export file, got %v", stat.Mode().Perm())
		}
	}
}

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
