package backend

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestApplicationRuntimeIsReferenceOnly(t *testing.T) {
	runtime := NewApplicationRuntime(nil)
	require.NotNil(t, runtime)

	runtimeType := reflect.TypeOf(ApplicationRuntime{})
	require.Zero(t, runtimeType.NumMethod(), "the composition root must not own behavior")
	for index := 0; index < runtimeType.NumField(); index++ {
		field := runtimeType.Field(index)
		require.Equalf(t, reflect.Pointer, field.Type.Kind(), "composition field %s must be a component reference", field.Name)
		require.Truef(t, field.IsExported(), "composition field %s must be wired directly without root accessors", field.Name)
	}
}

func TestBackendOwnersDoNotRetainTheCompositionRoot(t *testing.T) {
	paths, err := filepath.Glob("*.go")
	require.NoError(t, err)
	var violations []string
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		require.NoError(t, parseErr)
		for _, declaration := range parsed.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.TYPE {
				continue
			}
			for _, specification := range general.Specs {
				typeSpec, ok := specification.(*ast.TypeSpec)
				if !ok {
					continue
				}
				structure, ok := typeSpec.Type.(*ast.StructType)
				if !ok {
					continue
				}
				for _, field := range structure.Fields.List {
					if !isPointerToIdentifier(field.Type, "ApplicationRuntime") {
						continue
					}
					for _, name := range field.Names {
						violations = append(violations, filepath.Base(path)+":"+typeSpec.Name.Name+"."+name.Name)
					}
				}
			}
		}
	}
	sort.Strings(violations)
	require.Empty(t, violations, "backend owners must receive focused collaborators, never the composition root")
}

type ownerSize struct {
	Fields  int
	Methods int
}

func TestBackendOwnerSizeDistributionRemainsReviewed(t *testing.T) {
	expected := map[string]ownerSize{
		"ApplicationLifecycle":         {Fields: 13, Methods: 22},
		"AppLogService":                {Fields: 1, Methods: 7},
		"ClusterAttentionService":      {Fields: 4, Methods: 17},
		"ClusterRuntimeManager":        {Fields: 22, Methods: 69},
		"ClusterWorkspaceProjection":   {Fields: 4, Methods: 5},
		"ContainerLogsSelectionPolicy": {Fields: 1, Methods: 2},
		"DataManagementCoordinator":    {Fields: 13, Methods: 9},
		"DesktopService":               {Fields: 14, Methods: 91},
		"DesktopShell":                 {Fields: 17, Methods: 44},
		"ErrorReportingService":        {Fields: 7, Methods: 7},
		"FavoritesService":             {Fields: 1, Methods: 11},
		"OperationsCoordinator":        {Fields: 17, Methods: 41},
		"PreferencesService":           {Fields: 13, Methods: 68},
		"PermissionFetchPolicy":        {Fields: 1, Methods: 2},
		"RefreshCoordinator":           {Fields: 47, Methods: 108},
		"ResourceGateway":              {Fields: 16, Methods: 140},
		"UIStateStore":                 {Fields: 1, Methods: 12},
		"UpdateCoordinator":            {Fields: 8, Methods: 21},
		"WorkspaceCoordinator":         {Fields: 27, Methods: 91},
	}
	require.Equal(t, expected, measuredOwnerSizes(t, expected))
}

func measuredOwnerSizes(t testing.TB, owners map[string]ownerSize) map[string]ownerSize {
	t.Helper()
	result := make(map[string]ownerSize, len(owners))
	for owner := range owners {
		result[owner] = ownerSize{}
	}
	paths, err := filepath.Glob("*.go")
	require.NoError(t, err)
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		require.NoError(t, parseErr)
		for _, declaration := range parsed.Decls {
			switch declaration := declaration.(type) {
			case *ast.GenDecl:
				for _, specification := range declaration.Specs {
					typeSpec, ok := specification.(*ast.TypeSpec)
					if !ok {
						continue
					}
					size, tracked := result[typeSpec.Name.Name]
					structure, isStruct := typeSpec.Type.(*ast.StructType)
					if !tracked || !isStruct {
						continue
					}
					for _, field := range structure.Fields.List {
						if len(field.Names) == 0 {
							size.Fields++
						} else {
							size.Fields += len(field.Names)
						}
					}
					result[typeSpec.Name.Name] = size
				}
			case *ast.FuncDecl:
				if declaration.Recv == nil || len(declaration.Recv.List) != 1 {
					continue
				}
				owner := receiverIdentifier(declaration.Recv.List[0].Type)
				size, tracked := result[owner]
				if tracked {
					size.Methods++
					result[owner] = size
				}
			}
		}
	}
	return result
}

func isPointerToIdentifier(expression ast.Expr, name string) bool {
	pointer, ok := expression.(*ast.StarExpr)
	if !ok {
		return false
	}
	identifier, ok := pointer.X.(*ast.Ident)
	return ok && identifier.Name == name
}

func receiverIdentifier(expression ast.Expr) string {
	if pointer, ok := expression.(*ast.StarExpr); ok {
		expression = pointer.X
	}
	identifier, _ := expression.(*ast.Ident)
	if identifier == nil {
		return ""
	}
	return identifier.Name
}

func TestApplicationRuntimeIsReservedForCompositionAndLifecycleTests(t *testing.T) {
	allowed := map[string]struct{}{
		"app_lifecycle_init_test.go":           {},
		"app_lifecycle_test.go":                {},
		"app_runtime_test.go":                  {},
		"application_runtime_contract_test.go": {},
	}
	paths, err := filepath.Glob("*_test.go")
	require.NoError(t, err)

	var violations []string
	for _, path := range paths {
		if _, ok := allowed[filepath.Base(path)]; ok {
			continue
		}
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		require.NoError(t, parseErr)
		usesRuntime := false
		ast.Inspect(parsed, func(node ast.Node) bool {
			identifier, ok := node.(*ast.Ident)
			if !ok {
				return true
			}
			switch identifier.Name {
			case "ApplicationRuntime", "NewApplicationRuntime":
				usesRuntime = true
				return false
			default:
				return true
			}
		})
		if usesRuntime {
			violations = append(violations, filepath.Base(path))
		}
	}
	sort.Strings(violations)
	require.Empty(t, violations, "domain tests must construct focused owner fixtures, not the full application runtime")
}
