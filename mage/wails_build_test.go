package mage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompareDirectoryTrees(t *testing.T) {
	t.Run("matching trees", func(t *testing.T) {
		expected := t.TempDir()
		actual := t.TempDir()
		writeTestFile(t, expected, "app/models.ts", "export type App = {}\n")
		writeTestFile(t, actual, "app/models.ts", "export type App = {}\n")

		if err := CompareDirectoryTrees(expected, actual); err != nil {
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

			err := CompareDirectoryTrees(expected, actual)
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
