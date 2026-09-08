package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRootGoPackageContainsOnlyTheAssetEntrypoint(t *testing.T) {
	files, err := filepath.Glob(repositoryPath("*.go"))
	require.NoError(t, err)
	require.Equal(t, []string{repositoryPath("main.go")}, files,
		"implementation and tests belong with their internal owners")

	source, err := parser.ParseFile(token.NewFileSet(), files[0], nil, parser.ParseComments)
	require.NoError(t, err)
	for _, declaration := range source.Decls {
		switch declaration := declaration.(type) {
		case *ast.FuncDecl:
			require.Equal(t, "main", declaration.Name.Name, "startup helpers belong in internal packages")
			require.Nil(t, declaration.Recv)
		case *ast.GenDecl:
			require.NotEqual(t, token.TYPE, declaration.Tok, "entrypoint must not own application types")
		}
	}
	for _, specification := range source.Imports {
		path, err := strconv.Unquote(specification.Path.Value)
		require.NoError(t, err)
		require.Contains(t, []string{"embed", "github.com/luxury-yacht/app/internal/bootstrap"}, path,
			"the entrypoint delegates startup and must not depend on runtime implementations")
	}
}
