package sentryreporting

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProductionGoCodeImportsSentryOnlyThroughReporter(t *testing.T) {
	repositoryRoot, err := filepath.Abs(filepath.Join("..", ".."))
	require.NoError(t, err)

	var directImports []string
	err = filepath.WalkDir(repositoryRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", "dist", "node_modules", "vendor":
				return filepath.SkipDir
			default:
				return nil
			}
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		relative, err := filepath.Rel(repositoryRoot, path)
		if err != nil {
			return err
		}
		if strings.HasPrefix(filepath.ToSlash(relative), "internal/sentry/") {
			return nil
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(contents), `"github.com/getsentry/sentry-go`) {
			directImports = append(directImports, relative)
		}
		return nil
	})
	require.NoError(t, err)
	require.Empty(t, directImports,
		"route Sentry through internal/sentry so consent and privacy policy cannot be bypassed")
}
