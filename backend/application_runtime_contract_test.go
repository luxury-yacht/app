package backend

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
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

func TestBackendOwnersDoNotEmbedOtherOwners(t *testing.T) {
	ownerTypes := []reflect.Type{
		reflect.TypeOf(ApplicationLifecycle{}),
		reflect.TypeOf(AppLogService{}),
		reflect.TypeOf(ClusterAttentionService{}),
		reflect.TypeOf(ClusterRuntimeManager{}),
		reflect.TypeOf(ClusterWorkspaceProjection{}),
		reflect.TypeOf(DataManagementCoordinator{}),
		reflect.TypeOf(DesktopService{}),
		reflect.TypeOf(DesktopShell{}),
		reflect.TypeOf(ErrorReportingService{}),
		reflect.TypeOf(FavoritesService{}),
		reflect.TypeOf(OperationsCoordinator{}),
		reflect.TypeOf(PreferencesService{}),
		reflect.TypeOf(RefreshCoordinator{}),
		reflect.TypeOf(ResourceGateway{}),
		reflect.TypeOf(UIStateStore{}),
		reflect.TypeOf(UpdateCoordinator{}),
		reflect.TypeOf(WorkspaceCoordinator{}),
	}
	ownersByType := make(map[reflect.Type]struct{}, len(ownerTypes))
	for _, owner := range ownerTypes {
		ownersByType[owner] = struct{}{}
	}

	var violations []string
	for _, owner := range ownerTypes {
		for index := 0; index < owner.NumField(); index++ {
			field := owner.Field(index)
			if !field.Anonymous {
				continue
			}
			fieldType := field.Type
			if fieldType.Kind() == reflect.Pointer {
				fieldType = fieldType.Elem()
			}
			if _, isOwner := ownersByType[fieldType]; isOwner {
				violations = append(violations, owner.Name()+" embeds "+fieldType.Name())
			}
		}
	}

	sort.Strings(violations)
	require.Empty(t, violations, "owners must depend on narrow capabilities, never embed another owner")
}

func TestBackendOwnersReferenceOtherOwnersOnlyThroughInterfaces(t *testing.T) {
	ownerTypes := []reflect.Type{
		reflect.TypeOf(ApplicationLifecycle{}),
		reflect.TypeOf(AppLogService{}),
		reflect.TypeOf(ClusterAttentionService{}),
		reflect.TypeOf(ClusterRuntimeManager{}),
		reflect.TypeOf(ClusterWorkspaceProjection{}),
		reflect.TypeOf(DataManagementCoordinator{}),
		reflect.TypeOf(DesktopService{}),
		reflect.TypeOf(DesktopShell{}),
		reflect.TypeOf(ErrorReportingService{}),
		reflect.TypeOf(FavoritesService{}),
		reflect.TypeOf(OperationsCoordinator{}),
		reflect.TypeOf(PreferencesService{}),
		reflect.TypeOf(RefreshCoordinator{}),
		reflect.TypeOf(ResourceGateway{}),
		reflect.TypeOf(UIStateStore{}),
		reflect.TypeOf(UpdateCoordinator{}),
		reflect.TypeOf(WorkspaceCoordinator{}),
	}
	ownersByType := make(map[reflect.Type]struct{}, len(ownerTypes))
	for _, owner := range ownerTypes {
		ownersByType[owner] = struct{}{}
	}

	var violations []string
	for _, owner := range ownerTypes {
		for index := 0; index < owner.NumField(); index++ {
			field := owner.Field(index)
			fieldType := field.Type
			if fieldType.Kind() != reflect.Pointer {
				continue
			}
			if _, isOwner := ownersByType[fieldType.Elem()]; isOwner {
				violations = append(violations, owner.Name()+"."+field.Name+" references "+fieldType.Elem().Name())
			}
		}
	}

	sort.Strings(violations)
	require.Empty(t, violations, "owner dependencies must be consumer-defined interfaces")
}

func TestApplicationRuntimeUsesOwnerConstructorsInsteadOfFieldPoking(t *testing.T) {
	parsed, err := parser.ParseFile(token.NewFileSet(), "app.go", nil, 0)
	require.NoError(t, err)

	owners := map[string]struct{}{
		"ClusterRuntime": {},
		"Refresh":        {},
		"Workspace":      {},
	}
	var violations []string
	ast.Inspect(parsed, func(node ast.Node) bool {
		assignment, ok := node.(*ast.AssignStmt)
		if !ok {
			return true
		}
		for _, expression := range assignment.Lhs {
			selector, ok := expression.(*ast.SelectorExpr)
			if !ok {
				continue
			}
			if identifier, ok := selector.X.(*ast.Ident); ok && identifier.Name == "lifecycle" {
				violations = append(violations, "ApplicationLifecycle."+selector.Sel.Name)
				continue
			}
			ownerSelector, ok := selector.X.(*ast.SelectorExpr)
			if !ok {
				continue
			}
			root, ok := ownerSelector.X.(*ast.Ident)
			if !ok || root.Name != "runtime" {
				continue
			}
			if _, tracked := owners[ownerSelector.Sel.Name]; tracked {
				violations = append(violations, ownerSelector.Sel.Name+"."+selector.Sel.Name)
			}
		}
		return true
	})

	sort.Strings(violations)
	require.Empty(t, violations, "owners must receive dependencies through constructors")
}

func TestApplicationRuntimeHasNoPostConstructionBinding(t *testing.T) {
	parsed, err := parser.ParseFile(token.NewFileSet(), "app.go", nil, 0)
	require.NoError(t, err)

	var violations []string
	ast.Inspect(parsed, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		name := selector.Sel.Name
		if name == "Bind" || strings.HasPrefix(name, "Configure") || strings.HasPrefix(name, "configure") {
			violations = append(violations, name)
		}
		return true
	})

	sort.Strings(violations)
	require.Empty(t, violations, "production owners must be complete when their constructors return")
}

func TestMainDoesNotConfigureOwnersAfterRuntimeConstruction(t *testing.T) {
	source, err := os.ReadFile("../main.go")
	require.NoError(t, err)

	for _, forbidden := range []string{
		"ConfigureApplicationUpdates",
		"ConfigureWorkspaceWindowCreator",
	} {
		require.NotContains(t, string(source), forbidden,
			"composition options must be supplied before NewApplicationRuntime returns")
	}
}

func TestProductionDoesNotUseProcessGlobalNodeMaintenanceState(t *testing.T) {
	var violations []string
	err := filepath.Walk(".", func(path string, info os.FileInfo, walkErr error) error {
		require.NoError(t, walkErr)
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		source, readErr := os.ReadFile(path)
		require.NoError(t, readErr)
		if strings.Contains(string(source), "GlobalStore") {
			violations = append(violations, path)
		}
		return nil
	})
	require.NoError(t, err)
	sort.Strings(violations)
	require.Empty(t, violations, "node-maintenance state must be composed once and injected into every producer and consumer")
}

func TestOwnerFixturesDoNotConfigureOwnersByPrivateFieldAssignment(t *testing.T) {
	source, err := os.ReadFile("owner_fixtures_test.go")
	require.NoError(t, err)

	for _, forbidden := range []string{
		".Lifecycle.clusterRuntime =",
		".Lifecycle.refresh =",
		".Lifecycle.workspace =",
		".Lifecycle.operations =",
		".Lifecycle.preferences =",
		".Lifecycle.errorReporting =",
		".Lifecycle.updates =",
		".Preferences.effects =",
		".Preferences.logger =",
	} {
		require.NotContains(t, string(source), forbidden,
			"shared fixtures must mirror production constructor wiring")
	}
}

func TestAppGoContainsCompositionOnly(t *testing.T) {
	parsed, err := parser.ParseFile(token.NewFileSet(), "app.go", nil, 0)
	require.NoError(t, err)

	var violations []string
	for _, declaration := range parsed.Decls {
		switch declaration := declaration.(type) {
		case *ast.FuncDecl:
			if declaration.Recv != nil || declaration.Name.Name != "NewApplicationRuntime" {
				violations = append(violations, "function "+declaration.Name.Name)
			}
		case *ast.GenDecl:
			if declaration.Tok != token.TYPE {
				continue
			}
			for _, specification := range declaration.Specs {
				typeSpec, ok := specification.(*ast.TypeSpec)
				if ok && typeSpec.Name.Name != "ApplicationRuntime" && typeSpec.Name.Name != "ApplicationRuntimeOptions" {
					violations = append(violations, "type "+typeSpec.Name.Name)
				}
			}
		}
	}

	sort.Strings(violations)
	require.Empty(t, violations, "app.go must contain only the composition result and composition function")
}

func TestLegacyPreferenceCompatibilityMethodsRemainAbsent(t *testing.T) {
	forbidden := map[string]struct{}{
		"GetAppearanceModeInfo":                       {},
		"SetAccentColor":                              {},
		"SetAppearanceMode":                           {},
		"SetAutoRefreshEnabled":                       {},
		"SetBackgroundRefreshEnabled":                 {},
		"SetDefaultObjectPanelPosition":               {},
		"SetDimInactiveNamespaces":                    {},
		"SetExclusiveNamespaces":                      {},
		"SetGridTablePersistenceMode":                 {},
		"SetKubernetesClientBurst":                    {},
		"SetKubernetesClientQPS":                      {},
		"SetLinkColor":                                {},
		"SetObjPanelLogsAPITimestampFormat":           {},
		"SetObjPanelLogsAPITimestampUseLocalTimeZone": {},
		"SetObjPanelLogsBufferMaxSize":                {},
		"SetObjPanelLogsTargetGlobalLimit":            {},
		"SetObjPanelLogsTargetPerScopeLimit":          {},
		"SetObjectPanelLayout":                        {},
		"SetPaletteTint":                              {},
		"SetPermissionSSRRFetchConcurrency":           {},
		"SetUseShortResourceNames":                    {},
	}

	parsed, err := parser.ParseFile(token.NewFileSet(), "preferences_settings.go", nil, 0)
	require.NoError(t, err)
	var violations []string
	for _, declaration := range parsed.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Recv == nil {
			continue
		}
		if _, forbiddenMethod := forbidden[function.Name.Name]; forbiddenMethod {
			violations = append(violations, function.Name.Name)
		}
	}

	sort.Strings(violations)
	require.Empty(t, violations, "tests must exercise UpdateAppPreferences instead of production-only compatibility methods")
}

func TestLegacyAppPrefixedProductionFilesRemainAbsent(t *testing.T) {
	paths, err := filepath.Glob("app_*.go")
	require.NoError(t, err)

	allowed := map[string]struct{}{
		"app_log_service.go":          {},
		"app_log_service_commands.go": {},
	}
	var violations []string
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		if _, ok := allowed[filepath.Base(path)]; !ok {
			violations = append(violations, filepath.Base(path))
		}
	}

	require.Empty(t, violations, "production files must be named for their focused owner")
}

func TestProductionFilesBelongToOneStateOwner(t *testing.T) {
	ownerNames := map[string]struct{}{
		"ApplicationLifecycle": {}, "AppLogService": {}, "ClusterAttentionService": {},
		"ClusterRuntimeManager": {}, "ClusterWorkspaceProjection": {}, "DataManagementCoordinator": {},
		"DesktopService": {}, "DesktopShell": {}, "ErrorReportingService": {}, "FavoritesService": {},
		"OperationsCoordinator": {}, "PreferencesService": {}, "RefreshCoordinator": {},
		"ResourceGateway": {}, "UIStateStore": {}, "UpdateCoordinator": {}, "WorkspaceCoordinator": {},
	}
	allowed := map[string]struct{}{
		// The generator deliberately emits the internal resource owner and its
		// sole Wails transport projection from one resource-kind registry.
		"resource_details_generated.go": {},
	}
	paths, err := filepath.Glob("*.go")
	require.NoError(t, err)
	var violations []string
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		if _, ok := allowed[filepath.Base(path)]; ok {
			continue
		}
		parsed, parseErr := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		require.NoError(t, parseErr)
		owners := make(map[string]struct{})
		for _, declaration := range parsed.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Recv == nil || len(function.Recv.List) != 1 {
				continue
			}
			receiver := function.Recv.List[0].Type
			if pointer, ok := receiver.(*ast.StarExpr); ok {
				receiver = pointer.X
			}
			identifier, _ := receiver.(*ast.Ident)
			if identifier == nil {
				continue
			}
			if _, isOwner := ownerNames[identifier.Name]; isOwner {
				owners[identifier.Name] = struct{}{}
			}
		}
		if len(owners) > 1 {
			names := make([]string, 0, len(owners))
			for owner := range owners {
				names = append(names, owner)
			}
			sort.Strings(names)
			violations = append(violations, filepath.Base(path)+": "+strings.Join(names, ", "))
		}
	}
	sort.Strings(violations)
	require.Empty(t, violations, "each production file must have one state owner")
}

func isPointerToIdentifier(expression ast.Expr, name string) bool {
	pointer, ok := expression.(*ast.StarExpr)
	if !ok {
		return false
	}
	identifier, ok := pointer.X.(*ast.Ident)
	return ok && identifier.Name == name
}

func TestApplicationRuntimeIsReservedForCompositionAndLifecycleTests(t *testing.T) {
	allowed := map[string]struct{}{
		"application_lifecycle_init_test.go":       {},
		"application_lifecycle_test.go":            {},
		"desktop_shell_runtime_test.go":            {},
		"application_runtime_contract_test.go":     {},
		"application_runtime_construction_test.go": {},
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
