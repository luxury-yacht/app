package main

import (
	"bufio"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const maxFunctionParameters = 7

func TestProductionFunctionsStayWithinParameterLimit(t *testing.T) {
	t.Helper()
	fset := token.NewFileSet()
	err := filepath.WalkDir(".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if entry.Name() == "vendor" || entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		generated, err := generatedGoFile(path)
		if err != nil || generated {
			return err
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Type.Params == nil {
				continue
			}
			if count := functionParameterCount(function); count > maxFunctionParameters {
				position := fset.Position(function.Pos())
				t.Errorf("%s:%d: %s has %d parameters; maximum is %d", position.Filename, position.Line, function.Name.Name, count, maxFunctionParameters)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan production Go functions: %v", err)
	}
}

func functionParameterCount(function *ast.FuncDecl) int {
	count := 0
	for _, field := range function.Type.Params.List {
		if len(field.Names) == 0 {
			count++
			continue
		}
		count += len(field.Names)
	}
	return count
}

func generatedGoFile(path string) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for line := 0; line < 10 && scanner.Scan(); line++ {
		text := scanner.Text()
		if strings.Contains(text, "Code generated") && strings.Contains(text, "DO NOT EDIT") {
			return true, nil
		}
	}
	return false, scanner.Err()
}
