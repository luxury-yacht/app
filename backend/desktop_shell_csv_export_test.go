package backend

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestSaveCSVFileUsesWailsDialogOptionsAndWritesSelection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pods.csv")
	ready := true
	shell := NewDesktopShell(nil, func() bool { return ready }, nil, NewLogger(10))
	var options application.SaveFileDialogOptions
	shell.saveFileDialog = func(input *application.SaveFileDialogOptions) (string, error) {
		options = *input
		return path, nil
	}

	result, err := shell.SaveCsvFile("pods", "name\npod-a\n")

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

func TestSaveLogFileOffersALogFileAndWritesSelection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pod-api-logs.log")
	shell := NewDesktopShell(nil, func() bool { return true }, nil, NewLogger(10))
	var options application.SaveFileDialogOptions
	shell.saveFileDialog = func(input *application.SaveFileDialogOptions) (string, error) {
		options = *input
		return path, nil
	}

	result, err := shell.SaveLogFile("pod-api-logs", "line one\nline two")

	require.NoError(t, err)
	require.Equal(t, "Save Logs", options.Title)
	require.Equal(t, "pod-api-logs.log", options.Filename)
	require.Equal(t, []application.FileFilter{{DisplayName: "Log files (*.log)", Pattern: "*.log"}}, options.Filters)
	require.Equal(t, path, result.Path)
	contents, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "line one\nline two", string(contents))
}

// Dismissing the save dialog is not a failure. macOS and Linux report it as an
// empty selection; Windows as Wails' "cancelled by user" error. Either way the
// save reports a cancel and writes nothing.
func TestSaveExportFileReportsADismissedDialogAsCanceled(t *testing.T) {
	dismissals := map[string]func(*application.SaveFileDialogOptions) (string, error){
		"empty selection": func(*application.SaveFileDialogOptions) (string, error) { return "", nil },
		"windows cancel":  func(*application.SaveFileDialogOptions) (string, error) { return "", errors.New("cancelled by user") },
	}
	for name, dialog := range dismissals {
		t.Run(name, func(t *testing.T) {
			shell := NewDesktopShell(nil, func() bool { return true }, nil, NewLogger(10))
			shell.saveFileDialog = dialog

			csv, err := shell.SaveCsvFile("pods", "name\n")
			require.NoError(t, err)
			require.Equal(t, CatalogQueryCSVExport{Canceled: true}, csv)

			logs, err := shell.SaveLogFile("pod-logs", "line")
			require.NoError(t, err)
			require.Equal(t, CatalogQueryCSVExport{Canceled: true}, logs)
		})
	}
}

// A dialog that fails for another reason is still an error.
func TestSaveExportFileReportsAFailedDialog(t *testing.T) {
	shell := NewDesktopShell(nil, func() bool { return true }, nil, NewLogger(10))
	shell.saveFileDialog = func(*application.SaveFileDialogOptions) (string, error) {
		return "", errors.New("no window")
	}

	_, err := shell.SaveCsvFile("pods", "name\n")
	require.ErrorContains(t, err, "no window")
}

// The atomic write must produce an owner-only file with the full content
// durably written. Exports carry cluster resource data, so they stay unreadable
// to other local accounts; the exporting user keeps read/write and can relax
// the mode themselves.
func TestWriteExportFileAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "export.csv")

	info, err := writeExportFileAtomically(path, "a,b\n1,2\n")
	if err != nil {
		t.Fatalf("writeExportFileAtomically failed: %v", err)
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

func TestSanitizeExportFilename(t *testing.T) {
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
		if got := sanitizeExportFilename(c.in, ".csv"); got != c.want {
			t.Errorf("sanitizeExportFilename(%q, .csv) = %q, want %q", c.in, got, c.want)
		}
	}
	if got := sanitizeExportFilename("node/a.LOG", ".log"); got != "node-a.LOG" {
		t.Errorf("sanitizeExportFilename(node/a.LOG, .log) = %q", got)
	}
}
