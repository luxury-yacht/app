package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// sanitizeCsvFilename returns a safe, non-empty default filename ending in .csv for
// the save dialog. Path separators are flattened so a label can't escape the chosen
// directory; an existing .csv suffix (any case) is preserved.
func sanitizeCsvFilename(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		trimmed = "export"
	}
	trimmed = strings.ReplaceAll(trimmed, "/", "-")
	trimmed = strings.ReplaceAll(trimmed, "\\", "-")
	if !strings.HasSuffix(strings.ToLower(trimmed), ".csv") {
		trimmed += ".csv"
	}
	return trimmed
}

// SaveCsvFile writes a frontend-built CSV string to a user-selected file. The content
// is produced client-side from the table's displayed columns, so the exported CSV
// matches the on-screen table exactly; this keeps only the file IO (and the
// potentially large byte payload) on the Go side. Returns the chosen path and size.
func (a *App) SaveCsvFile(defaultFilename string, content string) (CatalogQueryCSVExport, error) {
	var empty CatalogQueryCSVExport
	if a == nil {
		return empty, fmt.Errorf("app is not initialised")
	}
	if a.Ctx == nil {
		return empty, fmt.Errorf("application context is not available")
	}

	path, err := runtimeSaveFileDialog(a.Ctx, wailsruntime.SaveDialogOptions{
		Title:           "Export CSV",
		DefaultFilename: sanitizeCsvFilename(defaultFilename),
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "CSV files (*.csv)", Pattern: "*.csv"},
		},
		CanCreateDirectories: true,
	})
	if err != nil {
		return empty, fmt.Errorf("select CSV export file: %w", err)
	}
	path = strings.TrimSpace(path)
	if path == "" {
		return empty, fmt.Errorf("CSV export canceled")
	}

	info, err := writeCSVFileAtomically(path, content)
	if err != nil {
		return empty, err
	}
	return CatalogQueryCSVExport{Path: path, Bytes: info.Size()}, nil
}

// writeCSVFileAtomically writes content to a sibling temp file, fsyncs it (the
// point of write-then-rename is surviving a crash; without the sync the rename
// can land before the data), makes it user-readable (CreateTemp creates 0600),
// and renames it into place.
func writeCSVFileAtomically(path string, content string) (os.FileInfo, error) {
	tempFile, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return nil, fmt.Errorf("create CSV export: %w", err)
	}
	tempPath := tempFile.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tempPath)
		}
	}()

	if _, err := tempFile.WriteString(content); err != nil {
		_ = tempFile.Close()
		return nil, fmt.Errorf("write CSV export: %w", err)
	}
	if err := tempFile.Sync(); err != nil {
		_ = tempFile.Close()
		return nil, fmt.Errorf("sync CSV export: %w", err)
	}
	if err := tempFile.Close(); err != nil {
		return nil, fmt.Errorf("close CSV export: %w", err)
	}
	if err := os.Chmod(tempPath, 0o644); err != nil {
		return nil, fmt.Errorf("set CSV export permissions: %w", err)
	}
	info, err := os.Stat(tempPath)
	if err != nil {
		return nil, fmt.Errorf("stat CSV export: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return nil, fmt.Errorf("move CSV export into place: %w", err)
	}
	cleanup = false
	return info, nil
}
