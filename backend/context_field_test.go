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

func TestRepositoryStructsDoNotStoreContext(t *testing.T) {
	t.Parallel()

	var findings []string
	productionRoots := []string{".", "../internal", "../main.go"}
	for _, root := range productionRoots {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
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
					relativePath, relErr := filepath.Rel("..", path)
					if relErr != nil {
						relativePath = path
					}
					findings = append(findings, filepath.ToSlash(relativePath)+":"+strconv.Itoa(position.Line))
				}
				return true
			})
			return nil
		})
		if err != nil {
			t.Fatalf("scan repository Go files under %s: %v", root, err)
		}
	}

	sort.Strings(findings)
	if len(findings) > 0 {
		t.Fatalf("context.Context must be passed to methods, not stored in struct fields:\n%s", strings.Join(findings, "\n"))
	}
}

func TestIsStoredContextType(t *testing.T) {
	t.Parallel()

	contextImports := map[string]struct{}{"context": {}}
	tests := []struct {
		name     string
		typeExpr string
		stored   bool
	}{
		{name: "direct", typeExpr: "context.Context", stored: true},
		{name: "pointer", typeExpr: "*context.Context", stored: true},
		{name: "slice", typeExpr: "[]context.Context", stored: true},
		{name: "map value", typeExpr: "map[string]context.Context", stored: true},
		{name: "function parameter", typeExpr: "func(context.Context)", stored: false},
		{name: "different package", typeExpr: "other.Context", stored: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expr, err := parser.ParseExpr(tt.typeExpr)
			if err != nil {
				t.Fatalf("parse %q: %v", tt.typeExpr, err)
			}
			if got := isContextType(expr, contextImports); got != tt.stored {
				t.Fatalf("isContextType(%q) = %t, want %t", tt.typeExpr, got, tt.stored)
			}
		})
	}
}

func isContextType(expr ast.Expr, contextImports map[string]struct{}) bool {
	switch typed := expr.(type) {
	case *ast.SelectorExpr:
		if typed.Sel.Name != "Context" {
			return false
		}
		packageName, ok := typed.X.(*ast.Ident)
		if !ok {
			return false
		}
		_, ok = contextImports[packageName.Name]
		return ok
	case *ast.StarExpr:
		return isContextType(typed.X, contextImports)
	case *ast.ArrayType:
		return isContextType(typed.Elt, contextImports)
	case *ast.MapType:
		return isContextType(typed.Key, contextImports) || isContextType(typed.Value, contextImports)
	case *ast.ChanType:
		return isContextType(typed.Value, contextImports)
	case *ast.ParenExpr:
		return isContextType(typed.X, contextImports)
	default:
		return false
	}
}
