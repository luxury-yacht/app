package backend

import (
	"go/ast"
	"go/parser"
	"go/token"
	"sort"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDesktopServiceCommandsDelegateToTheirDeclaredOwners(t *testing.T) {
	expectedOwners := map[string]struct {
		field string
		count int
	}{
		"FavoritesCommands":      {field: "favorites", count: 5},
		"UIStateCommands":        {field: "uiState", count: 7},
		"PreferencesCommands":    {field: "preferences", count: 13},
		"DataManagementCommands": {field: "dataManagement", count: 5},
		"ClusterAttentionCommands": {
			field: "attention", count: 6,
		},
		"WorkspaceCommands":      {field: "workspace", count: 6},
		"ClusterRuntimeCommands": {field: "clusterRuntime", count: 3},
		"ResourceCommands":       {field: "resources", count: 17},
		"OperationsCommands":     {field: "operations", count: 10},
		"UpdateCommands":         {field: "updates", count: 6},
		"AppLogCommands":         {field: "logs", count: 5},
		"DesktopShellCommands":   {field: "desktopShell", count: 4},
		"PanelWindowCommands":    {field: "panelWindows", count: 19},
	}

	parsed, err := parser.ParseFile(token.NewFileSet(), "desktop_service.go", nil, 0)
	require.NoError(t, err)
	interfaces := desktopCommandInterfaces(parsed, expectedOwners)
	delegations := desktopCommandDelegations(t, parsed)

	seen := make(map[string]string, len(delegations))
	for interfaceName, owner := range expectedOwners {
		methods, found := interfaces[interfaceName]
		require.Truef(t, found, "missing %s", interfaceName)
		require.Len(t, methods, owner.count, interfaceName)
		for _, method := range methods {
			if previous, duplicate := seen[method]; duplicate {
				t.Fatalf("command %s belongs to both %s and %s", method, previous, interfaceName)
			}
			seen[method] = interfaceName
			require.Equal(t, owner.field+"."+method, delegations[method], method)
		}
	}
	require.Len(t, seen, 106)
	require.Len(t, delegations, 106)
}

func desktopCommandInterfaces(
	parsed *ast.File,
	expected map[string]struct {
		field string
		count int
	},
) map[string][]string {
	result := make(map[string][]string, len(expected))
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
			if _, tracked := expected[typeSpec.Name.Name]; !tracked {
				continue
			}
			contract, ok := typeSpec.Type.(*ast.InterfaceType)
			if !ok {
				continue
			}
			methods := make([]string, 0, len(contract.Methods.List))
			for _, method := range contract.Methods.List {
				for _, name := range method.Names {
					methods = append(methods, name.Name)
				}
			}
			sort.Strings(methods)
			result[typeSpec.Name.Name] = methods
		}
	}
	return result
}

func desktopCommandDelegations(t *testing.T, parsed *ast.File) map[string]string {
	t.Helper()
	result := make(map[string]string, 101)
	frameworkMethods := map[string]struct{}{
		"ServiceStartup":  {},
		"ServiceShutdown": {},
		"ServeHTTP":       {},
	}
	for _, declaration := range parsed.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Recv == nil || len(function.Recv.List) != 1 ||
			!isPointerToIdentifier(function.Recv.List[0].Type, "DesktopService") {
			continue
		}
		if _, framework := frameworkMethods[function.Name.Name]; framework {
			continue
		}
		delegation := ""
		ast.Inspect(function.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			method, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			owner, ok := method.X.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			receiver, ok := owner.X.(*ast.Ident)
			if !ok || receiver.Name != "s" {
				return true
			}
			delegation = owner.Sel.Name + "." + method.Sel.Name
			return false
		})
		require.NotEmpty(t, delegation, function.Name.Name)
		result[function.Name.Name] = delegation
	}
	return result
}
