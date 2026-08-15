package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestGeneratedWailsAppExportsMatchFrontendBoundary(t *testing.T) {
	generated := exportedFunctions(readTestFile(t, repositoryPath(
		"frontend", "bindings", "github.com", "luxury-yacht", "app", "backend", "app.ts",
	)))
	boundary := explicitBackendAPIExports(readTestFile(t, repositoryPath(
		"frontend", "src", "core", "backend-api", "index.ts",
	)))

	if !slices.Equal(generated, boundary) {
		t.Fatalf("generated Wails exports must match frontend boundary\ngenerated: %v\nboundary: %v", generated, boundary)
	}
}

func TestGeneratedWailsEventsCoverBackendBoundary(t *testing.T) {
	generated := readTestFile(t, repositoryPath(
		"frontend", "bindings", "github.com", "wailsapp", "wails", "v3", "internal", "eventdata.d.ts",
	))
	expected := []string{
		"app-logs:added",
		"app-update",
		"backend-error",
		"cluster:auth:failed",
		"cluster:auth:progress",
		"cluster:auth:recovered",
		"cluster:auth:recovering",
		"cluster:health:degraded",
		"cluster:health:healthy",
		"cluster:lifecycle",
		"cluster:scope:changed",
		"debug:open-inspector",
		"debug:toggle-error-overlay",
		"debug:toggle-focus-overlay",
		"debug:toggle-icon-overlay",
		"debug:toggle-map-overlay",
		"debug:toggle-panel-overlay",
		"kubeconfig:available-changed",
		"menu:close",
		"menu:copy",
		"menu:cut",
		"menu:paste",
		"menu:selectAll",
		"object-shell:list",
		"object-shell:output",
		"object-shell:status",
		"open-about",
		"open-cluster",
		"open-command-palette",
		"open-settings",
		"portforward:list",
		"portforward:status",
		"runtime-operations:list",
		"toggle-app-logs-panel",
		"toggle-diagnostics",
		"toggle-object-diff",
		"toggle-sidebar",
		"zoom-in",
		"zoom-out",
		"zoom-reset",
	}

	for _, eventName := range expected {
		if !strings.Contains(generated, `"`+eventName+`":`) {
			t.Errorf("generated Wails event boundary is missing %q", eventName)
		}
	}
}

func exportedFunctions(source string) []string {
	result := []string{}
	for line := range strings.Lines(source) {
		line = strings.TrimSpace(line)
		const prefix = "export function "
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		name, _, _ := strings.Cut(strings.TrimPrefix(line, prefix), "(")
		result = append(result, name)
	}
	slices.Sort(result)
	return result
}

func explicitBackendAPIExports(source string) []string {
	result := []string{}
	inExportBlock := false
	for line := range strings.Lines(source) {
		line = strings.TrimSpace(line)
		if line == "export {" {
			inExportBlock = true
			continue
		}
		if !inExportBlock {
			continue
		}
		if strings.HasPrefix(line, "} from ") {
			break
		}
		if name := strings.TrimSuffix(line, ","); name != "" {
			result = append(result, name)
		}
	}
	slices.Sort(result)
	return result
}

func TestCompareDirectoryTrees(t *testing.T) {
	t.Run("matching trees", func(t *testing.T) {
		expected := t.TempDir()
		actual := t.TempDir()
		writeTestFile(t, expected, "app/models.ts", "export type App = {}\n")
		writeTestFile(t, actual, "app/models.ts", "export type App = {}\n")

		if err := compareDirectoryTrees(expected, actual); err != nil {
			t.Fatalf("CompareDirectoryTrees() error = %v", err)
		}
	})

	tests := []struct {
		name          string
		expectedFiles map[string]string
		actualFiles   map[string]string
		wantError     string
	}{
		{
			name:          "changed generated file",
			expectedFiles: map[string]string{"app/models.ts": "old"},
			actualFiles:   map[string]string{"app/models.ts": "new"},
			wantError:     "content differs: app/models.ts",
		},
		{
			name:          "missing generated file",
			expectedFiles: map[string]string{"app/models.ts": "model"},
			actualFiles:   map[string]string{},
			wantError:     "missing generated file: app/models.ts",
		},
		{
			name:          "unexpected generated file",
			expectedFiles: map[string]string{},
			actualFiles:   map[string]string{"app/models.ts": "model"},
			wantError:     "unexpected generated file: app/models.ts",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			expected := t.TempDir()
			actual := t.TempDir()
			for path, contents := range test.expectedFiles {
				writeTestFile(t, expected, path, contents)
			}
			for path, contents := range test.actualFiles {
				writeTestFile(t, actual, path, contents)
			}

			err := compareDirectoryTrees(expected, actual)
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("CompareDirectoryTrees() error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func writeTestFile(t *testing.T, root, path, contents string) {
	t.Helper()
	fullPath := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fullPath, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}
