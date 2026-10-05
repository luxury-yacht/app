package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// exportFileKind describes a file type the app saves from frontend-built text.
type exportFileKind struct {
	// noun names the file in errors, e.g. "CSV export".
	noun        string
	dialogTitle string
	extension   string
	filter      application.FileFilter
}

var (
	csvExportFile = exportFileKind{
		noun:        "CSV export",
		dialogTitle: "Export CSV",
		extension:   ".csv",
		filter:      application.FileFilter{DisplayName: "CSV files (*.csv)", Pattern: "*.csv"},
	}
	logExportFile = exportFileKind{
		noun:        "log file",
		dialogTitle: "Save Logs",
		extension:   ".log",
		filter:      application.FileFilter{DisplayName: "Log files (*.log)", Pattern: "*.log"},
	}
)

// sanitizeExportFilename returns a safe, non-empty default filename ending in the
// extension for the save dialog. Path separators are flattened so a label can't
// escape the chosen directory; an existing suffix (any case) is preserved.
func sanitizeExportFilename(name, extension string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		trimmed = "export"
	}
	trimmed = strings.ReplaceAll(trimmed, "/", "-")
	trimmed = strings.ReplaceAll(trimmed, "\\", "-")
	if !strings.HasSuffix(strings.ToLower(trimmed), extension) {
		trimmed += extension
	}
	return trimmed
}

// SaveCsvFile writes a frontend-built CSV string to a user-selected file. The content
// is produced client-side from the table's displayed columns, so the exported CSV
// matches the on-screen table exactly; this keeps only the file IO (and the
// potentially large byte payload) on the Go side. Returns the chosen path and size.
func (s *DesktopShell) SaveCsvFile(defaultFilename, content string) (CatalogQueryCSVExport, error) {
	return s.saveExportFile(csvExportFile, defaultFilename, content)
}

// SaveLogFile writes the logs a Logs tab shows, as the frontend built them, to a
// user-selected .log file. Returns the chosen path and size.
func (s *DesktopShell) SaveLogFile(defaultFilename, content string) (CatalogQueryCSVExport, error) {
	return s.saveExportFile(logExportFile, defaultFilename, content)
}

func (s *DesktopShell) saveExportFile(kind exportFileKind, defaultFilename, content string) (CatalogQueryCSVExport, error) {
	var empty CatalogQueryCSVExport
	if s == nil {
		return empty, fmt.Errorf("desktop shell is not initialised")
	}
	if !s.runtimeAvailable() {
		return empty, fmt.Errorf("application context is not available")
	}

	path, err := s.promptForSaveFile(&application.SaveFileDialogOptions{
		Title:                kind.dialogTitle,
		Filename:             sanitizeExportFilename(defaultFilename, kind.extension),
		Filters:              []application.FileFilter{kind.filter},
		CanCreateDirectories: true,
	})
	if err != nil {
		return empty, fmt.Errorf("select %s file: %w", kind.noun, err)
	}
	path = strings.TrimSpace(path)
	if path == "" {
		return CatalogQueryCSVExport{Canceled: true}, nil
	}

	info, err := writeExportFileAtomically(path, content)
	if err != nil {
		return empty, fmt.Errorf("%s: %w", kind.noun, err)
	}
	return CatalogQueryCSVExport{Path: path, Bytes: info.Size()}, nil
}

// writeExportFileAtomically writes content to a sibling temp file, fsyncs it (the
// point of write-then-rename is surviving a crash; without the sync the rename
// can land before the data), makes it user-readable (CreateTemp creates 0600),
// and renames it into place.
func writeExportFileAtomically(path, content string) (os.FileInfo, error) {
	tempFile, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return nil, fmt.Errorf("create file: %w", err)
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
		return nil, fmt.Errorf("write file: %w", err)
	}
	if err := tempFile.Sync(); err != nil {
		_ = tempFile.Close()
		return nil, fmt.Errorf("sync file: %w", err)
	}
	if err := tempFile.Close(); err != nil {
		return nil, fmt.Errorf("close file: %w", err)
	}
	// Exported files are readable only by the owner.
	if err := os.Chmod(tempPath, 0o600); err != nil {
		return nil, fmt.Errorf("set file permissions: %w", err)
	}
	info, err := os.Stat(tempPath)
	if err != nil {
		return nil, fmt.Errorf("stat file: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return nil, fmt.Errorf("move file into place: %w", err)
	}
	cleanup = false
	return info, nil
}
