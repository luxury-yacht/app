package backend

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Every built-in kind reaches the app through one feed: its owned reflector
// (docs/architecture/data-layer.md). Production code must not bring back the
// shared typed-informer factory, which would watch kinds a second time, or the
// IngestOwned facet that split kinds between the two feeds. The container
// logs' per-session pod informer is a live boundary, not a feed, and uses its
// own constructor.
func TestProductionCodeHasOneFeedTechnology(t *testing.T) {
	const sharedFactoryPackage = "k8s.io/client-go/informers"
	forbidden := map[string]bool{"SharedInformerFactory": true, "IngestOwned": true}
	var violations []string
	err := filepath.WalkDir(".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), path, nil, parser.SkipObjectResolution)
		if parseErr != nil {
			return parseErr
		}
		for _, spec := range parsed.Imports {
			if importPath, _ := strconv.Unquote(spec.Path.Value); importPath == sharedFactoryPackage {
				violations = append(violations, path+": imports "+sharedFactoryPackage)
			}
		}
		ast.Inspect(parsed, func(node ast.Node) bool {
			if ident, ok := node.(*ast.Ident); ok && forbidden[ident.Name] {
				violations = append(violations, path+": "+ident.Name)
			}
			return true
		})
		return nil
	})
	require.NoError(t, err)
	require.Empty(t, violations)
}
