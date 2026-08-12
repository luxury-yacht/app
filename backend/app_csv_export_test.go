package backend

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestSaveCSVFileUsesWailsDialogOptionsAndWritesSelection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pods.csv")
	app := NewApp(nil)
	setTestAppRuntimeReady(t, app, context.Background())
	var options application.SaveFileDialogOptions
	app.saveFileDialog = func(input *application.SaveFileDialogOptions) (string, error) {
		options = *input
		return path, nil
	}

	result, err := app.SaveCsvFile("pods", "name\npod-a\n")

	require.NoError(t, err)
	require.Equal(t, "Export CSV", options.Title)
	require.Equal(t, "pods.csv", options.Filename)
	require.Equal(t, []application.FileFilter{{DisplayName: "CSV files (*.csv)", Pattern: "*.csv"}}, options.Filters)
	require.Equal(t, path, result.Path)
	require.Equal(t, int64(len("name\npod-a\n")), result.Bytes)
	contents, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "name\npod-a\n", string(contents))
}

// The atomic write must produce an owner-only file with the full content
// durably written. Exports carry cluster resource data, so they stay unreadable
// to other local accounts; the exporting user keeps read/write and can relax
// the mode themselves.
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
		if stat.Mode().Perm() != 0o600 {
			t.Fatalf("expected 0600 export file, got %v", stat.Mode().Perm())
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
