package backend

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

func TestBackendStructsDoNotStoreContext(t *testing.T) {
	t.Parallel()

	var findings []string
	err := filepath.WalkDir(".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}

		files := token.NewFileSet()
		parsed, err := parser.ParseFile(files, path, nil, 0)
		if err != nil {
			return err
		}
		contextImports := map[string]struct{}{}
		for _, imported := range parsed.Imports {
			importPath, err := strconv.Unquote(imported.Path.Value)
			if err != nil || importPath != "context" {
				continue
			}
			name := "context"
			if imported.Name != nil {
				name = imported.Name.Name
			}
			contextImports[name] = struct{}{}
		}
		if len(contextImports) == 0 {
			return nil
		}

		ast.Inspect(parsed, func(node ast.Node) bool {
			structType, ok := node.(*ast.StructType)
			if !ok {
				return true
			}
			for _, field := range structType.Fields.List {
				if !isContextType(field.Type, contextImports) {
					continue
				}
				position := files.Position(field.Pos())
				findings = append(findings, filepath.ToSlash(path)+":"+strconv.Itoa(position.Line))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("scan backend Go files: %v", err)
	}

	sort.Strings(findings)
	if len(findings) > 0 {
		t.Fatalf("context.Context must be passed to methods, not stored in struct fields:\n%s", strings.Join(findings, "\n"))
	}
}

func isContextType(expr ast.Expr, contextImports map[string]struct{}) bool {
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != "Context" {
		return false
	}
	packageName, ok := selector.X.(*ast.Ident)
	if !ok {
		return false
	}
	_, ok = contextImports[packageName.Name]
	return ok
}
