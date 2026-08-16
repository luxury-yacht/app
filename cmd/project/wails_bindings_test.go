package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestGeneratedWailsServiceExportsMatchFrontendBoundary(t *testing.T) {
	serviceType := registeredWailsServiceType(t, readTestFile(t, repositoryPath("main.go")))
	_, generatedSource := generatedWailsServiceModule(t, serviceType)
	generated := exportedFunctions(generatedSource)
	boundary := explicitBackendAPIExports(readTestFile(t, repositoryPath(
		"frontend", "src", "core", "backend-api", "index.ts",
	)))

	if err := validateWailsBoundaryParity(generated, boundary); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopServiceIsTheOnlyGeneratedCallableBackendModule(t *testing.T) {
	root := repositoryPath("frontend", "bindings", "github.com", "luxury-yacht", "app", "backend")
	modules := make([]string, 0)
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() || filepath.Ext(path) != ".ts" {
			return nil
		}
		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(source), "$Call.ByName") {
			relative, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			modules = append(modules, filepath.ToSlash(relative))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(modules)
	if !slices.Equal(modules, []string{"desktopservice.ts"}) {
		t.Fatalf("generated callable backend modules = %v, want only desktopservice.ts", modules)
	}
}

func TestBindingModelAnchorKeepsEveryDetailDTOReachable(t *testing.T) {
	path := repositoryPath("backend", "resource_details_generated.go")
	parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	imports := make(map[string]string)
	for _, specification := range parsed.Imports {
		importPath, err := strconv.Unquote(specification.Path.Value)
		if err != nil {
			t.Fatal(err)
		}
		alias := filepath.Base(importPath)
		if specification.Name != nil {
			alias = specification.Name.Name
		}
		imports[alias] = importPath
	}

	foundAnchor := false
	for _, declaration := range parsed.Decls {
		general, ok := declaration.(*ast.GenDecl)
		if !ok || general.Tok != token.TYPE {
			continue
		}
		for _, specification := range general.Specs {
			typeSpec, ok := specification.(*ast.TypeSpec)
			if !ok || typeSpec.Name.Name != "BindingModelAnchor" {
				continue
			}
			foundAnchor = true
			anchor, ok := typeSpec.Type.(*ast.StructType)
			if !ok {
				t.Fatal("BindingModelAnchor must be a struct")
			}
			for _, field := range anchor.Fields.List {
				pointer, ok := field.Type.(*ast.StarExpr)
				if !ok {
					t.Fatalf("BindingModelAnchor field must be a pointer: %#v", field.Type)
				}
				modelPath := repositoryPath("frontend", "bindings", "github.com", "luxury-yacht", "app", "backend", "models.ts")
				modelName := ""
				switch modelType := pointer.X.(type) {
				case *ast.Ident:
					modelName = modelType.Name
				case *ast.SelectorExpr:
					packageName, ok := modelType.X.(*ast.Ident)
					if !ok {
						t.Fatalf("unsupported anchor selector %#v", modelType.X)
					}
					importPath, ok := imports[packageName.Name]
					if !ok {
						t.Fatalf("anchor package %q has no import", packageName.Name)
					}
					const backendPrefix = "github.com/luxury-yacht/app/backend/"
					relativePackage := strings.TrimPrefix(importPath, backendPrefix)
					if relativePackage == importPath {
						t.Fatalf("anchor import %q is outside backend bindings", importPath)
					}
					modelPath = repositoryPath("frontend", "bindings", "github.com", "luxury-yacht", "app", "backend", relativePackage, "models.ts")
					modelName = modelType.Sel.Name
				default:
					t.Fatalf("unsupported anchor type %#v", pointer.X)
				}
				modelSource := readTestFile(t, modelPath)
				if !generatedModelsDeclare(modelSource, modelName) {
					t.Fatalf("%s does not declare anchored DTO %s", modelPath, modelName)
				}
			}
		}
	}
	if !foundAnchor {
		t.Fatal("BindingModelAnchor was not generated")
	}
}

func generatedModelsDeclare(source, name string) bool {
	for _, declaration := range []string{"export interface ", "export type ", "export class ", "export enum "} {
		if strings.Contains(source, declaration+name) {
			return true
		}
	}
	return false
}

func TestWailsBoundaryContractRejectsCompositionAndExportMutations(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	serviceType, err := resolveRegisteredWailsServiceType(mainSource)
	if err != nil {
		t.Fatal(err)
	}
	if serviceType != "DesktopService" {
		t.Fatalf("current registered service type = %q, want DesktopService", serviceType)
	}

	compositionMutations := map[string]string{
		"missing service registration": strings.Replace(mainSource, "RegisterService", "RegisterBackend", 1),
		"unnamed service expression": strings.Replace(
			mainSource,
			"application.NewServiceWithOptions(\n\t\tdesktopService,",
			"application.NewServiceWithOptions(\n\t\tbackend.NewApp(nil, reporter),",
			1,
		),
		"service without concrete declared type": strings.Replace(
			strings.Replace(mainSource, "\tvar desktopService *backend.DesktopService\n", "", 1),
			"\tdesktopService = backend.NewDesktopService(",
			"\tdesktopService := backend.NewDesktopService(",
			1,
		),
		"multiple service registrations": strings.Replace(
			mainSource,
			"\twailsApp.RegisterService(application.NewServiceWithOptions(",
			"\twailsApp.RegisterService(application.NewServiceWithOptions(backendApp))\n\twailsApp.RegisterService(application.NewServiceWithOptions(",
			1,
		),
		"additional unnamed service registration": strings.Replace(
			mainSource,
			"\twailsApp.RegisterService(application.NewServiceWithOptions(",
			"\twailsApp.RegisterService(application.NewServiceWithOptions(backend.NewApp(nil, reporter)))\n\twailsApp.RegisterService(application.NewServiceWithOptions(",
			1,
		),
	}
	for name, source := range compositionMutations {
		t.Run(name, func(t *testing.T) {
			if _, err := resolveRegisteredWailsServiceType(source); err == nil {
				t.Fatal("mutated composition unexpectedly satisfied registered-service discovery")
			}
		})
	}

	_, generatedSource := generatedWailsServiceModule(t, serviceType)
	generated := exportedFunctions(generatedSource)
	boundary := explicitBackendAPIExports(readTestFile(t, repositoryPath("frontend", "src", "core", "backend-api", "index.ts")))
	if slices.Contains(generated, "InitializeErrorReporting") {
		t.Fatal("InitializeErrorReporting must not be generated as a frontend command")
	}
	if slices.Contains(boundary, "InitializeErrorReporting") {
		t.Fatal("InitializeErrorReporting must remain a composition-only entry point")
	}
	if err := validateWailsBoundaryParity(generated, boundary); err != nil {
		t.Fatal(err)
	}
	for name, mutation := range map[string]struct {
		generated []string
		boundary  []string
	}{
		"unbrokered generated command":    {generated: append(slices.Clone(generated), "UnexpectedCommand"), boundary: boundary},
		"frontend export without command": {generated: generated, boundary: append(slices.Clone(boundary), "MissingCommand")},
	} {
		t.Run(name, func(t *testing.T) {
			slices.Sort(mutation.generated)
			slices.Sort(mutation.boundary)
			if err := validateWailsBoundaryParity(mutation.generated, mutation.boundary); err == nil {
				t.Fatal("mutated export boundary unexpectedly satisfied command parity")
			}
		})
	}
}

func registeredWailsServiceType(t *testing.T, source string) string {
	t.Helper()
	serviceType, err := resolveRegisteredWailsServiceType(source)
	if err != nil {
		t.Fatal(err)
	}
	return serviceType
}

func resolveRegisteredWailsServiceType(source string) (string, error) {
	parsed, err := parser.ParseFile(token.NewFileSet(), "main.go", source, 0)
	if err != nil {
		return "", fmt.Errorf("parse main.go: %w", err)
	}

	serviceVariables := make([]string, 0)
	serviceRegistrationCount := 0
	ast.Inspect(parsed, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "RegisterService" || len(call.Args) != 1 {
			return true
		}
		serviceRegistrationCount++
		constructor, ok := call.Args[0].(*ast.CallExpr)
		if !ok || len(constructor.Args) == 0 {
			return true
		}
		identifier, ok := constructor.Args[0].(*ast.Ident)
		if ok {
			serviceVariables = append(serviceVariables, identifier.Name)
		}
		return true
	})
	if serviceRegistrationCount != 1 || len(serviceVariables) != 1 {
		return "", fmt.Errorf(
			"main.go must register exactly one named Wails service; found %d registrations and %d named services",
			serviceRegistrationCount,
			len(serviceVariables),
		)
	}
	serviceVariable := serviceVariables[0]

	serviceType := ""
	ast.Inspect(parsed, func(node ast.Node) bool {
		if serviceType != "" {
			return false
		}
		specification, ok := node.(*ast.ValueSpec)
		if !ok || specification.Type == nil {
			return true
		}
		matchesVariable := false
		for _, name := range specification.Names {
			matchesVariable = matchesVariable || name.Name == serviceVariable
		}
		if !matchesVariable {
			return true
		}
		pointer, ok := specification.Type.(*ast.StarExpr)
		if !ok {
			return true
		}
		selector, ok := pointer.X.(*ast.SelectorExpr)
		if ok && selector.Sel.Name != "" {
			serviceType = selector.Sel.Name
		}
		return true
	})
	if serviceType == "" {
		return "", fmt.Errorf("resolve concrete type of registered Wails service variable %q", serviceVariable)
	}
	return serviceType, nil
}

func validateWailsBoundaryParity(generated, boundary []string) error {
	if slices.Equal(generated, boundary) {
		return nil
	}
	return fmt.Errorf("generated Wails exports must match frontend boundary\ngenerated: %v\nboundary: %v", generated, boundary)
}

func generatedWailsServiceModule(t *testing.T, serviceType string) (string, string) {
	t.Helper()
	directory := repositoryPath("frontend", "bindings", "github.com", "luxury-yacht", "app", "backend")
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	callPrefix := `github.com/luxury-yacht/app/backend.` + serviceType + `.`
	matchedPath := ""
	matchedSource := ""
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".ts" || entry.Name() == "index.ts" || entry.Name() == "models.ts" {
			continue
		}
		path := filepath.Join(directory, entry.Name())
		source := readTestFile(t, path)
		if !strings.Contains(source, callPrefix) {
			continue
		}
		if matchedPath != "" {
			t.Fatalf("registered Wails service %s has multiple generated modules: %s and %s", serviceType, matchedPath, path)
		}
		matchedPath = path
		matchedSource = source
	}
	if matchedPath == "" {
		t.Fatalf("registered Wails service %s has no generated TypeScript module", serviceType)
	}
	return matchedPath, matchedSource
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
