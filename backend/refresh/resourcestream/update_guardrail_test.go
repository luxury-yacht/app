package resourcestream

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStreamHandlersDoNotConstructRowsDirectly(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok)
	dir := filepath.Dir(filename)

	allowedFiles := map[string]struct{}{
		"update_helpers.go": {},
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	require.NoError(t, err)
	for _, path := range files {
		base := filepath.Base(path)
		if strings.HasSuffix(base, "_test.go") {
			continue
		}
		if _, ok := allowedFiles[base]; ok {
			continue
		}

		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, nil, 0)
		require.NoError(t, err)
		ast.Inspect(file, func(node ast.Node) bool {
			switch n := node.(type) {
			case *ast.CompositeLit:
				if ident, ok := n.Type.(*ast.Ident); ok && ident.Name == "Update" {
					for _, elt := range n.Elts {
						kv, ok := elt.(*ast.KeyValueExpr)
						if !ok {
							continue
						}
						if key, ok := kv.Key.(*ast.Ident); ok && key.Name == "Row" {
							require.Failf(t, "direct row construction", "%s uses Update{Row: ...}; use projection/update helpers", fset.Position(kv.Pos()))
						}
					}
				}
			case *ast.AssignStmt:
				for _, lhs := range n.Lhs {
					selector, ok := lhs.(*ast.SelectorExpr)
					if ok && selector.Sel.Name == "Row" {
						require.Failf(t, "direct row assignment", "%s assigns update.Row; use projection/update helpers", fset.Position(selector.Pos()))
					}
				}
			}
			return true
		})
	}
}
