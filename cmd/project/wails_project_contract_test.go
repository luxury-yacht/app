package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func repositoryPath(elements ...string) string {
	return filepath.Join(append([]string{"..", ".."}, elements...)...)
}

func TestWailsBindingsUseInterfaces(t *testing.T) {
	taskfile, err := os.ReadFile(repositoryPath("build", "Taskfile.yml"))
	require.NoError(t, err)

	bindingCommand := "wails3 generate bindings"
	commandOffset := strings.Index(string(taskfile), bindingCommand)
	require.NotEqual(t, -1, commandOffset)
	commandLine := strings.Split(string(taskfile)[commandOffset:], "\n")[0]
	require.Contains(t, commandLine, " -i")
}

func TestWailsProjectUsesFreshInitBuildDefaults(t *testing.T) {
	rootTaskfile, err := os.ReadFile(repositoryPath("Taskfile.yml"))
	require.NoError(t, err)
	require.Contains(t, string(rootTaskfile), `BIN_DIR: "bin"`)
	require.Contains(t, string(rootTaskfile), `PACKAGE_MANAGER: '{{.PACKAGE_MANAGER | default "npm"}}'`)
	require.Contains(t, string(rootTaskfile), `VITE_PORT: '{{.WAILS_VITE_PORT | default 9245}}'`)

	config, err := os.ReadFile(repositoryPath("build", "config.yml"))
	require.NoError(t, err)
	require.NotContains(t, string(config), "build/bin")
}

func TestUnsignedInstallTaskPreservesExpectedWorkflow(t *testing.T) {
	rootTaskfile := readTestFile(t, repositoryPath("Taskfile.yml"))
	require.Contains(t, rootTaskfile, "install:unsigned:")
	require.Contains(t, rootTaskfile, "task: '{{OS}}:install:unsigned'")

	for platform, buildDependency := range map[string]string{
		"darwin":  "package",
		"linux":   "build",
		"windows": "build",
	} {
		taskfile := readTestFile(t, repositoryPath("build", platform, "Taskfile.yml"))
		require.Contains(t, taskfile, "install:unsigned:")
		require.Contains(t, taskfile, "task: "+buildDependency)
		require.Contains(t, taskfile, "go run ./cmd/project install-unsigned")
	}
}

func TestPlatformBuildManifestsUseCanonicalProjectMetadata(t *testing.T) {
	nfpmConfig := readTestFile(t, repositoryPath("build", "linux", "nfpm", "nfpm.yaml"))
	require.Contains(t, nfpmConfig, `version: "__APP_VERSION__"`)
	require.Contains(t, nfpmConfig, `name: "__APP_BINARY_NAME__"`)
	require.Contains(t, nfpmConfig, `description: "__APP_DESCRIPTION__"`)
	require.Contains(t, nfpmConfig, `vendor: "__APP_COMPANY__"`)
	require.Contains(t, nfpmConfig, `maintainer: "__APP_MAINTAINER__"`)
	require.NotContains(t, nfpmConfig, "GIT_COMMITTER")

	linuxDesktop := readTestFile(t, repositoryPath("build", "linux", "desktop"))
	require.Contains(t, linuxDesktop, "Name=__APP_NAME__")
	require.Contains(t, linuxDesktop, "Comment=__APP_DESCRIPTION__")
	require.Contains(t, linuxDesktop, "Exec=/usr/local/bin/__APP_BINARY_NAME__ %u")
	require.Contains(t, linuxDesktop, "Icon=__APP_BINARY_NAME__")

	linuxTaskfile := readTestFile(t, repositoryPath("build", "linux", "Taskfile.yml"))
	require.Contains(t, linuxTaskfile, "common:prepare:build-manifests")
	require.Contains(t, linuxTaskfile, "bin/build-manifests/linux/nfpm.yaml")
	require.Contains(t, linuxTaskfile, "bin/build-manifests/linux/app.desktop")

	for _, path := range []string{
		"build/darwin/Info.plist",
		"build/darwin/Info.dev.plist",
	} {
		manifest := readTestFile(t, repositoryPath(path))
		require.Contains(t, manifest, "<string>__APP_BINARY_NAME__</string>")
		require.Equalf(t, 2, strings.Count(manifest, "__APP_VERSION__"), "%s must derive both bundle versions", path)
		require.Contains(t, manifest, "<string>__APP_NAME__</string>")
		require.Contains(t, manifest, "<string>__APP_COPYRIGHT__</string>")
		require.Contains(t, manifest, "<string>__APP_COMMENTS__</string>")
	}

	windowsManifest := readTestFile(t, repositoryPath("build", "windows", "wails.exe.manifest"))
	require.Contains(t, windowsManifest, `name="__APP_IDENTIFIER__" version="__APP_VERSION__"`)

	windowsInfo := readTestFile(t, repositoryPath("build", "windows", "info.json"))
	require.Equal(t, 2, strings.Count(windowsInfo, "__APP_VERSION__"))
	for _, placeholder := range []string{
		"__APP_COMPANY__",
		"__APP_DESCRIPTION__",
		"__APP_COPYRIGHT__",
		"__APP_NAME__",
		"__APP_COMMENTS__",
	} {
		require.Contains(t, windowsInfo, placeholder)
	}

	windowsTools := readTestFile(t, repositoryPath("build", "windows", "nsis", "wails_tools.nsh"))
	require.Contains(t, windowsTools, `!define INFO_PRODUCTVERSION "__APP_VERSION__"`)
	require.Contains(t, windowsTools, `!define INFO_PROJECTNAME "__APP_BINARY_NAME__"`)
	require.Contains(t, windowsTools, `!define INFO_COMPANYNAME "__APP_COMPANY__"`)
	require.Contains(t, windowsTools, `!define INFO_PRODUCTNAME "__APP_NAME__"`)
	require.Contains(t, windowsTools, `!define INFO_COPYRIGHT "__APP_COPYRIGHT__"`)
	require.NotRegexp(t, `!define INFO_PRODUCTVERSION\s+"[v0-9]`, windowsTools)

	windowsMetadata := readTestFile(t, repositoryPath("build", "windows", "nsis", "project_metadata.nsh"))
	for _, placeholder := range []string{
		"__APP_COMPANY__",
		"__APP_BINARY_NAME__",
		"__APP_DESCRIPTION__",
		"__APP_COPYRIGHT__",
		"__APP_NAME__",
		"__APP_VERSION__",
		"__WINDOWS_VERSION__",
	} {
		require.Contains(t, windowsMetadata, placeholder)
	}

	windowsInstaller := readTestFile(t, repositoryPath("build", "windows", "nsis", "project.nsi"))
	require.Contains(t, windowsInstaller, `!include "..\..\..\bin\build-manifests\windows\nsis\project_metadata.nsh"`)
	require.Contains(t, windowsInstaller, `VIAddVersionKey "FileDescription" "${INFO_PRODUCTDESCRIPTION}"`)

	darwinTaskfile := readTestFile(t, repositoryPath("build", "darwin", "Taskfile.yml"))
	require.Contains(t, darwinTaskfile, "common:prepare:build-manifests")
	require.Contains(t, darwinTaskfile, "bin/build-manifests/darwin/Info.plist")
	require.Contains(t, darwinTaskfile, "bin/build-manifests/darwin/Info.dev.plist")

	windowsTaskfile := readTestFile(t, repositoryPath("build", "windows", "Taskfile.yml"))
	require.Contains(t, windowsTaskfile, "common:prepare:build-manifests")
	require.Contains(t, windowsTaskfile, "bin/build-manifests/windows/wails.exe.manifest")
	require.Contains(t, windowsTaskfile, "bin/build-manifests/windows/info.json")
	require.Contains(t, windowsTaskfile, `--input "{{.BIN_DIR}}/{{.APP_NAME}}-*-windows-{{.ARCH}}-installer.exe"`)
	require.NotContains(t, windowsTaskfile, `--input "build/windows/nsis/{{.APP_NAME}}-installer.exe"`)

	commonTaskfile := readTestFile(t, repositoryPath("build", "Taskfile.yml"))
	for _, flag := range []string{
		`-name "__APP_BINARY_NAME__"`,
		`-binaryname "__APP_BINARY_NAME__"`,
		`-productcompany "__APP_COMPANY__"`,
		`-productname "__APP_NAME__"`,
		`-productidentifier "__APP_IDENTIFIER__"`,
		`-productdescription "__APP_DESCRIPTION__"`,
		`-productcopyright "__APP_COPYRIGHT__"`,
		`-productcomments "__APP_COMMENTS__"`,
		`-productversion "__APP_VERSION__"`,
	} {
		require.Contains(t, commonTaskfile, flag)
	}

	rootTaskfile := readTestFile(t, repositoryPath("Taskfile.yml"))
	require.Contains(t, rootTaskfile, "sh: go run ./cmd/project binary-name")
	require.NotContains(t, rootTaskfile, `APP_NAME: "luxury-yacht"`)

	metadata, err := readProjectMetadata(repositoryPath("build", "config.yml"))
	require.NoError(t, err)
	manifestPaths := []string{
		"build/darwin/Info.plist",
		"build/darwin/Info.dev.plist",
		"build/linux/desktop",
		"build/linux/nfpm/nfpm.yaml",
		"build/windows/info.json",
		"build/windows/wails.exe.manifest",
		"build/windows/nsis/project.nsi",
		"build/windows/nsis/project_metadata.nsh",
		"build/windows/nsis/wails_tools.nsh",
	}
	canonicalValues := []string{
		metadata.Info.CompanyName,
		metadata.Info.ProductName,
		metadata.Info.ProductIdentifier,
		metadata.Info.Description,
		metadata.Info.Copyright,
		metadata.Info.Comments,
		metadata.LuxuryYacht.Maintainer,
	}
	hardcodedVersion := regexp.MustCompile(`(^|[^0-9.])` + regexp.QuoteMeta(metadata.Info.Version) + `([^0-9.]|$)`)
	for _, path := range manifestPaths {
		manifest := readTestFile(t, repositoryPath(path))
		for _, value := range canonicalValues {
			require.NotContainsf(t, manifest, value, "%s must not hardcode metadata from build/config.yml", path)
		}
		require.NotRegexpf(t, hardcodedVersion, manifest, "%s must not hardcode info.version from build/config.yml", path)
	}
	for _, path := range []string{
		"build/darwin/Info.plist",
		"build/darwin/Info.dev.plist",
		"build/linux/desktop",
		"build/windows/nsis/project_metadata.nsh",
		"build/windows/nsis/wails_tools.nsh",
	} {
		manifest := readTestFile(t, repositoryPath(path))
		require.NotContainsf(t, manifest, "luxury-yacht", "%s must not hardcode the binary name", path)
	}
	require.NotContains(t, nfpmConfig, `name: "luxury-yacht"`)
	require.NotContains(t, nfpmConfig, `./bin/luxury-yacht`)
	require.NotContains(t, nfpmConfig, `/usr/local/bin/luxury-yacht`)
}

func TestWailsProjectUsesFrameworkSingleInstanceHandling(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	require.Contains(t, mainSource, "&application.SingleInstanceOptions{")
	require.Contains(t, mainSource, "applicationProductIdentifier = updateidentity.ProductIdentifier")
	require.Contains(t, mainSource, "windows.FocusMostRecent()")
	require.NotContains(t, mainSource, "SecondLaunchCoordinator")

	buildConfig := readTestFile(t, repositoryPath("build", "config.yml"))
	require.Contains(t, buildConfig, `productIdentifier: "app.luxury-yacht.desktop"`)

	_, err := os.Stat(repositoryPath("internal", "desktop", "single_instance.go"))
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestNewWindowUsesTheInProcessPeerRegistry(t *testing.T) {
	for _, root := range []string{"backend", filepath.Join("frontend", "src")} {
		err := filepath.Walk(repositoryPath(root), func(path string, info os.FileInfo, walkErr error) error {
			require.NoError(t, walkErr)
			if info.IsDir() || strings.Contains(info.Name(), "_test.") || strings.Contains(info.Name(), ".test.") {
				return nil
			}
			switch filepath.Ext(path) {
			case ".go", ".ts", ".tsx", ".css":
			default:
				return nil
			}

			contents := strings.ToLower(readTestFile(t, path))
			require.NotContainsf(t, contents, "spawnnewwindow", "%s contains the legacy process-spawn callback", path)
			return nil
		})
		require.NoError(t, err)
	}

	menuSource := strings.ToLower(readTestFile(t, repositoryPath("backend", "menu.go")))
	require.Contains(t, menuSource, `"new window", "cmdorctrl+n"`)
	registrySource := readTestFile(t, repositoryPath("internal", "appwindow", "registry.go"))
	require.Contains(t, registrySource, "Window.NewWithOptions")
	require.NotContains(t, strings.ToLower(registrySource), "spawnnewwindow")
}

func TestWailsApplicationIsInjectedDirectlyWithoutDesktopAdapter(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	windowSource := readTestFile(t, repositoryPath("internal", "appwindow", "registry.go"))
	runtimeSource := readTestFile(t, repositoryPath("backend", "app_runtime.go"))
	menuSource := readTestFile(t, repositoryPath("backend", "menu.go"))
	_, desktopErr := os.Stat(repositoryPath("internal", "desktop"))
	require.NoError(t, validateDirectWailsComposition(mainSource, windowSource, runtimeSource, menuSource, desktopErr == nil))
}

func TestDesktopServiceOwnsTheWailsBoundaryWithoutAnAppBackpointer(t *testing.T) {
	source := readTestFile(t, repositoryPath("backend", "desktop_service.go"))
	parsed, err := parser.ParseFile(token.NewFileSet(), "desktop_service.go", source, parser.ParseComments)
	require.NoError(t, err)

	foundService := false
	for _, declaration := range parsed.Decls {
		general, ok := declaration.(*ast.GenDecl)
		if !ok || general.Tok != token.TYPE {
			continue
		}
		for _, specification := range general.Specs {
			typeSpec, ok := specification.(*ast.TypeSpec)
			if !ok || typeSpec.Name.Name != "DesktopService" {
				continue
			}
			foundService = true
			serviceStruct, ok := typeSpec.Type.(*ast.StructType)
			require.True(t, ok)
			for _, field := range serviceStruct.Fields.List {
				require.False(t, isNamedPointer(field.Type, "App"), "DesktopService must not retain *App")
				require.False(t, isNamedPointer(field.Type, "ApplicationRuntime"), "DesktopService must not retain *ApplicationRuntime")
			}
		}
	}
	require.True(t, foundService)
	require.Contains(t, source, "//wails:inject t*:void BindingModelAnchor;")
	require.NotContains(t, readTestFile(t, repositoryPath("backend", "app.go")), "//wails:inject")
}

func TestDirectWailsCompositionContractRejectsBoundaryRegressions(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	windowSource := readTestFile(t, repositoryPath("internal", "appwindow", "registry.go"))
	runtimeSource := readTestFile(t, repositoryPath("backend", "app_runtime.go"))
	menuSource := readTestFile(t, repositoryPath("backend", "menu.go"))

	tests := map[string]struct {
		main          string
		window        string
		runtime       string
		menu          string
		desktopExists bool
	}{
		"missing direct application injection": {
			main: strings.Replace(mainSource, "backend.NewApp(wailsApp, reporter)", "backend.NewApp(nil, reporter)", 1), window: windowSource, runtime: runtimeSource, menu: menuSource,
		},
		"native adapter": {
			main: strings.Replace(mainSource, "backend.NewApp(wailsApp, reporter)", "backend.NewAdapter(wailsApp, reporter)", 1), window: windowSource, runtime: runtimeSource, menu: menuSource,
		},
		"missing generated service registration": {
			main: strings.Replace(mainSource, "wailsApp.RegisterService(", "wailsApp.RegisterBackend(", 1), window: windowSource, runtime: runtimeSource, menu: menuSource,
		},
		"missing desktop service construction": {
			main: strings.Replace(mainSource, "backend.NewDesktopService(", "backend.NewBackendService(", 1), window: windowSource, runtime: runtimeSource, menu: menuSource,
		},
		"implementation registered directly": {
			main: strings.Replace(mainSource, "\t\tdesktopService,", "\t\tbackendApp,", 1), window: windowSource, runtime: runtimeSource, menu: menuSource,
		},
		"desktop interface": {
			main: mainSource, window: windowSource, runtime: runtimeSource + "\ntype Desktop interface{}\n", menu: menuSource,
		},
		"menu model": {
			main: mainSource, window: windowSource, runtime: runtimeSource, menu: menuSource + "\ntype MenuModel struct{}\n",
		},
		"desktop package": {
			main: mainSource, window: windowSource, runtime: runtimeSource, menu: menuSource, desktopExists: true,
		},
		"missing runtime-ready hook": {
			main: mainSource, window: strings.Replace(windowSource, "events.Common.WindowRuntimeReady", "events.Common.WindowOpened", 1), runtime: runtimeSource, menu: menuSource,
		},
		"missing closing hook": {
			main: mainSource, window: strings.Replace(windowSource, "events.Common.WindowClosing", "events.Common.WindowClosed", 1), runtime: runtimeSource, menu: menuSource,
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			require.Error(t, validateDirectWailsComposition(test.main, test.window, test.runtime, test.menu, test.desktopExists))
		})
	}
}

func TestUpdaterTempRootIsConfiguredBeforeAnyProcessDispatch(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	require.NoError(t, validateCompositionOrdering(mainSource))
}

func TestCompositionOrderingContractRejectsReorderedFixtures(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	for _, markers := range [][2]string{
		{"updatetemp.ConfigureProcess()", "backend.MaybeRunExecWrapper()"},
		{"backend.MaybeRunExecWrapper()", "reporter, reporterErr := newSentryReporter("},
		{"reporter, reporterErr := newSentryReporter(", "composition := newApplicationComposition("},
		{"composition := newApplicationComposition(", "backend.InitializeErrorReporting(composition.backend)"},
		{"backend.InitializeErrorReporting(composition.backend)", "composition.application.Run()"},
		{"backendApp = backend.NewApp(wailsApp, reporter)", "backend.ConfigureApplicationUpdates(backendApp,"},
		{"backend.ConfigureApplicationUpdates(backendApp,", "desktopService = backend.NewDesktopService("},
		{"desktopService = backend.NewDesktopService(", "wailsApp.HandleStream(backend.RefreshResourceStreamName"},
		{"wailsApp.HandleStream(backend.RefreshResourceStreamName", "wailsApp.HandleStream(backend.RefreshContainerLogsStreamName"},
		{"wailsApp.HandleStream(backend.RefreshContainerLogsStreamName", "wailsApp.RegisterService("},
		{"wailsApp.RegisterService(", "windows = appwindow.NewRegistry("},
	} {
		before, after := markers[0], markers[1]
		t.Run(before+" before "+after, func(t *testing.T) {
			require.Error(t, validateCompositionOrdering(swapSourceMarkers(t, mainSource, before, after)))
		})
	}
}

func TestWailsTransportEventsAndPeerHooksHaveOneCompositionOwner(t *testing.T) {
	tests := map[string]struct {
		marker string
		owners []string
	}{
		"api route": {
			marker: `application.ServiceOptions{Route: "/api/v2"}`,
			owners: []string{"main.go"},
		},
		"resource named stream": {
			marker: "wailsApp.HandleStream(backend.RefreshResourceStreamName",
			owners: []string{"main.go"},
		},
		"container logs named stream": {
			marker: "wailsApp.HandleStream(backend.RefreshContainerLogsStreamName",
			owners: []string{"main.go"},
		},
		"typed custom event registry": {
			marker: "application.RegisterEvent[",
			owners: []string{"backend/events.go"},
		},
		"degraded health event registration": {
			marker: "application.RegisterEvent[ClusterHealthEvent](clusterHealthDegradedEventName)",
			owners: []string{"backend/events.go"},
		},
		"healthy health event registration": {
			marker: "application.RegisterEvent[ClusterHealthEvent](clusterHealthHealthyEventName)",
			owners: []string{"backend/events.go"},
		},
		"scope event registration": {
			marker: "application.RegisterEvent[ClusterScopeChangedEvent](clusterScopeChangedEventName)",
			owners: []string{"backend/events.go"},
		},
		"degraded health event producer": {
			marker: "a.emitEvent(clusterHealthDegradedEventName",
			owners: []string{"backend/app_heartbeat.go"},
		},
		"healthy health event producer": {
			marker: "a.emitEvent(clusterHealthHealthyEventName",
			owners: []string{"backend/app_heartbeat.go"},
		},
		"scope event producer": {
			marker: "a.emitEvent(clusterScopeChangedEventName",
			owners: []string{"backend/app_cluster_settings.go"},
		},
		"peer runtime-ready hook": {
			marker: "window.OnWindowEvent(events.Common.WindowRuntimeReady",
			owners: []string{"internal/appwindow/registry.go"},
		},
		"peer closing hook": {
			marker: "window.RegisterHook(events.Common.WindowClosing",
			owners: []string{"internal/appwindow/registry.go"},
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, test.owners, productionGoFilesContaining(t, test.marker))
		})
	}
}

func validateDirectWailsComposition(mainSource, windowSource, runtimeSource, menuSource string, desktopExists bool) error {
	for description, required := range map[string]string{
		"direct application.App injection": "backend.NewApp(wailsApp, reporter)",
		"desktop service construction":     "desktopService = backend.NewDesktopService(",
		"generated service registration":   "wailsApp.RegisterService(application.NewServiceWithOptions(\n\t\tdesktopService,",
		"runtime-ready peer-window hook":   "events.Common.WindowRuntimeReady",
		"closing peer-window hook":         "events.Common.WindowClosing",
		"application run call":             "composition.application.Run()",
	} {
		source := mainSource
		if strings.Contains(description, "peer-window") {
			source = windowSource
		}
		if !strings.Contains(source, required) {
			return fmt.Errorf("missing %s marker %q", description, required)
		}
	}
	if strings.Contains(mainSource, "NewAdapter") {
		return fmt.Errorf("native desktop adapter is prohibited")
	}
	if strings.Contains(mainSource, "application.NewServiceWithOptions(\n\t\tbackendApp,") {
		return fmt.Errorf("backend implementation must not be registered directly")
	}
	if strings.Contains(runtimeSource, "type Desktop interface") {
		return fmt.Errorf("native desktop interface is prohibited")
	}
	if strings.Contains(menuSource, "MenuModel") {
		return fmt.Errorf("parallel menu model is prohibited")
	}
	if desktopExists {
		return fmt.Errorf("internal/desktop package is prohibited")
	}
	return nil
}

func isNamedPointer(expression ast.Expr, name string) bool {
	pointer, ok := expression.(*ast.StarExpr)
	if !ok {
		return false
	}
	identifier, ok := pointer.X.(*ast.Ident)
	return ok && identifier.Name == name
}

func validateCompositionOrdering(mainSource string) error {
	for _, sequence := range [][]string{
		{
			"updatetemp.ConfigureProcess()",
			"backend.MaybeRunExecWrapper()",
			"reporter, reporterErr := newSentryReporter(",
			"composition := newApplicationComposition(",
			"backend.InitializeErrorReporting(composition.backend)",
			"composition.application.Run()",
		},
		{
			"backendApp = backend.NewApp(wailsApp, reporter)",
			"backend.ConfigureApplicationUpdates(backendApp,",
			"desktopService = backend.NewDesktopService(",
			"wailsApp.HandleStream(backend.RefreshResourceStreamName",
			"wailsApp.HandleStream(backend.RefreshContainerLogsStreamName",
			"wailsApp.RegisterService(",
			"windows = appwindow.NewRegistry(",
		},
	} {
		previousOffset := -1
		for _, marker := range sequence {
			offset := strings.Index(mainSource, marker)
			if offset < 0 {
				return fmt.Errorf("missing composition marker %q", marker)
			}
			if offset <= previousOffset {
				return fmt.Errorf("composition marker %q is out of order", marker)
			}
			previousOffset = offset
		}
	}
	return nil
}

func swapSourceMarkers(t *testing.T, source, before, after string) string {
	t.Helper()
	require.Contains(t, source, before)
	require.Contains(t, source, after)
	const beforePlaceholder = "__WAILS_BEFORE_MARKER__"
	const afterPlaceholder = "__WAILS_AFTER_MARKER__"
	require.NotContains(t, source, beforePlaceholder)
	require.NotContains(t, source, afterPlaceholder)
	source = strings.Replace(source, before, beforePlaceholder, 1)
	source = strings.Replace(source, after, afterPlaceholder, 1)
	source = strings.Replace(source, beforePlaceholder, after, 1)
	return strings.Replace(source, afterPlaceholder, before, 1)
}

func productionGoFilesContaining(t *testing.T, marker string) []string {
	t.Helper()
	root := repositoryPath()
	result := make([]string, 0)
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		require.NoError(t, walkErr)
		if info.IsDir() {
			if path != root && strings.HasPrefix(info.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		if strings.Contains(readTestFile(t, path), marker) {
			relative, err := filepath.Rel(root, path)
			require.NoError(t, err)
			result = append(result, filepath.ToSlash(relative))
		}
		return nil
	})
	require.NoError(t, err)
	slices.Sort(result)
	return result
}

func TestWailsBuildPreparesProjectMetadataWithoutMage(t *testing.T) {
	taskfile, err := os.ReadFile(repositoryPath("build", "Taskfile.yml"))
	require.NoError(t, err)
	require.Contains(t, string(taskfile), "prepare:build:")
	require.Contains(t, string(taskfile), "go run ./cmd/project build-metadata")
	require.Contains(t, string(taskfile), "task: prepare:build")
	require.NotContains(t, string(taskfile), "mage build-assets")

	for _, path := range []string{"cmd/buildmeta", "internal/buildmeta"} {
		_, err := os.Stat(repositoryPath(path))
		require.ErrorIs(t, err, os.ErrNotExist)
	}
}

func TestWailsProjectBuildsOnlyOnNativePlatformRunners(t *testing.T) {
	for _, path := range []string{
		"Taskfile.yml",
		"build/Taskfile.yml",
		"build/darwin/Taskfile.yml",
		"build/linux/Taskfile.yml",
		"build/windows/Taskfile.yml",
	} {
		taskfile := readTestFile(t, repositoryPath(strings.Split(path, "/")...))
		require.NotContainsf(t, strings.ToLower(taskfile), "docker", "%s must not expose Docker builds", path)
	}

	_, err := os.Stat(repositoryPath("build", "docker"))
	require.ErrorIs(t, err, os.ErrNotExist)

	extensions := readTestFile(t, repositoryPath(".vscode", "extensions.json"))
	require.NotContains(t, strings.ToLower(extensions), "docker")
}

func TestBuildDownloadsAreHardened(t *testing.T) {
	appImageBuild := readTestFile(t, repositoryPath("build", "linux", "appimage", "build.sh"))
	require.NotContains(t, appImageBuild, "wget ")
	require.Contains(t, appImageBuild, `--proto "=https"`)
	require.NotContains(t, appImageBuild, "/continuous/")
	require.Contains(t, appImageBuild, "sha256sum -c -")
}

func TestWailsProjectGeneratesModernMacOSIconAssets(t *testing.T) {
	taskfile, err := os.ReadFile(repositoryPath("build", "Taskfile.yml"))
	require.NoError(t, err)
	require.Contains(t, string(taskfile), "-iconcomposerinput appicon.icon")
	require.Contains(t, string(taskfile), "-macassetdir darwin")

	iconConfig, err := os.ReadFile(repositoryPath("build", "appicon.icon", "icon.json"))
	require.NoError(t, err)
	require.Contains(t, string(iconConfig), `"image-name" : "captain-k8s-color.png"`)

	icon, err := os.ReadFile(repositoryPath("build", "appicon.icon", "Assets", "captain-k8s-color.png"))
	require.NoError(t, err)
	legacyIcon, err := os.ReadFile(repositoryPath("build", "appicon.png"))
	require.NoError(t, err)
	require.Equal(t, legacyIcon, icon)

	config, err := os.ReadFile(repositoryPath("build", "config.yml"))
	require.NoError(t, err)
	require.Contains(t, string(config), `cfBundleIconName: "appicon"`)
	for _, path := range []string{"build/darwin/Info.plist", "build/darwin/Info.dev.plist"} {
		plist, err := os.ReadFile(repositoryPath(path))
		require.NoError(t, err)
		require.Contains(t, string(plist), "<key>CFBundleIconName</key>")
		require.Contains(t, string(plist), "<string>appicon</string>")
	}
}

func TestProjectUsesWailsTaskRunnerWithoutMage(t *testing.T) {
	taskfile, err := os.ReadFile(repositoryPath("Taskfile.yml"))
	require.NoError(t, err)
	for _, task := range []string{
		"clean:all:",
		"qc:prerelease:",
		"test:backend-coverage:",
		"release:app:",
		"storybook:",
	} {
		require.Contains(t, string(taskfile), task)
	}

	for _, path := range []string{"magefile.go", "mage"} {
		_, err := os.Stat(repositoryPath(path))
		require.ErrorIs(t, err, os.ErrNotExist)
	}

	for _, path := range []string{"go.mod", "mise.toml", ".github/workflows/release.yml"} {
		contents, err := os.ReadFile(repositoryPath(path))
		require.NoError(t, err)
		require.NotContains(t, strings.ToLower(string(contents)), "github.com/magefile/")
	}

	for _, root := range []string{".agents", "docs"} {
		err := filepath.Walk(repositoryPath(root), func(path string, info os.FileInfo, walkErr error) error {
			require.NoError(t, walkErr)
			if info.IsDir() || filepath.Ext(path) != ".md" {
				return nil
			}

			contents := readTestFile(t, path)
			require.NotContainsf(t, strings.ToLower(contents), "mise exec -- mage", "%s contains an obsolete Mage command", path)
			return nil
		})
		require.NoError(t, err)
	}

	editorSettings := readTestFile(t, repositoryPath(".vscode", "settings.json"))
	require.NotContains(t, strings.ToLower(editorSettings), "-tags=mage")
}

func TestReleaseWorkflowUsesConfiguredVVersionTags(t *testing.T) {
	workflow := readTestFile(t, repositoryPath(".github", "workflows", "release.yml"))
	require.Contains(t, workflow, `- "v[1-9]*"`)
	require.NotContains(t, workflow, `- "[1-9]*"`)

	metadata, err := readProjectMetadata(repositoryPath("build", "config.yml"))
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(strings.ToLower(metadata.Info.Version), "v"))
}

func TestReleasePublishingJobsUseCanonicalMiseToolchain(t *testing.T) {
	workflow := readTestFile(t, repositoryPath(".github", "workflows", "release.yml"))
	setupAction := readTestFile(t, repositoryPath(".github", "actions", "setup-toolchain", "action.yaml"))
	releaseStart := strings.Index(workflow, "\n  release:\n")
	updateSiteStart := strings.Index(workflow, "\n  update-site:\n")
	require.GreaterOrEqual(t, releaseStart, 0)
	require.Greater(t, updateSiteStart, releaseStart)
	releaseJob := workflow[releaseStart:updateSiteStart]
	updateSiteJob := workflow[updateSiteStart:]

	require.Contains(t, releaseJob, `install-linux-deps: "true"`)
	require.Contains(t, releaseJob, "wails3 task release:prepare-updater-manifest")
	require.Contains(t, updateSiteJob, `install-linux-deps: "true"`)
	require.Contains(t, updateSiteJob, "wails3 task release:site")
	require.Contains(t, releaseJob, "wails3 task release:app")
	require.NotContains(t, workflow, "setup-node:")
	require.NotContains(t, workflow, "install-wails:")

	require.Contains(t, setupAction, "uses: jdx/mise-action@v4")
	require.NotContains(t, setupAction, "install_args:")
	require.NotContains(t, setupAction, "setup-node:")
	require.NotContains(t, setupAction, "install-wails:")

	for _, command := range []string{
		"go run ./cmd/project prepare-release-updater-manifest",
		"go run ./cmd/project release-app",
		"go run ./cmd/project release-site",
	} {
		require.NotContains(t, workflow, command)
	}
}

func TestReleaseWorkflowValidatesTagBeforeTestsAndBuilds(t *testing.T) {
	workflow := readTestFile(t, repositoryPath(".github", "workflows", "release.yml"))
	require.NotContains(t, workflow, "  validate-release:\n")
	require.Contains(t, workflow, `RELEASE_TAG: ${{ github.ref_type == 'tag' && github.ref_name || '' }}`)
	require.Contains(t, workflow, "go run ./cmd/project validate-release-tag")
	require.Less(
		t,
		strings.Index(workflow, "      - name: Validate release tag"),
		strings.Index(workflow, "      - name: Run tests"),
	)
}

func TestReleaseArtifactsPreserveVersionPlatformAndArchitectureIdentity(t *testing.T) {
	workflow := readTestFile(t, repositoryPath(".github", "workflows", "release.yml"))
	require.Contains(t, workflow, "bin/*-macos-*.dmg")
	require.Contains(t, workflow, "GOOS=darwin GOARCH=arm64 RELEASE_FORMAT=dmg go run ./cmd/project release-artifact-name")
	require.Contains(t, workflow, "GOOS=darwin GOARCH=amd64 RELEASE_FORMAT=dmg go run ./cmd/project release-artifact-name")
	require.Contains(t, workflow, "linux:generate:deb ARCH=${{ matrix.arch }}")
	require.Contains(t, workflow, "linux:generate:rpm ARCH=${{ matrix.arch }}")

	linuxTaskfile := readTestFile(t, repositoryPath("build", "linux", "Taskfile.yml"))
	require.Contains(t, linuxTaskfile, "go run ./cmd/project release-artifact-name")

	windowsInstaller := readTestFile(t, repositoryPath("build", "windows", "nsis", "project.nsi"))
	require.Contains(t, windowsInstaller, `${INFO_PROJECTNAME}-${INFO_PRODUCTVERSION}-windows-${ARCH}-installer.exe`)

	windowsTaskfile := readTestFile(t, repositoryPath("build", "windows", "Taskfile.yml"))
	require.Contains(t, windowsTaskfile, `{{.APP_NAME}}-*-windows-{{.ARCH}}-installer.exe`)
}

func TestMacOSReleasePublishesAndValidatesTheWailsUpdaterPayload(t *testing.T) {
	workflow := readTestFile(t, repositoryPath(".github", "workflows", "release.yml"))
	require.Contains(t, workflow, "bin/*-darwin-*.zip")
	for _, architecture := range []string{"arm64", "amd64"} {
		packageCall := "wails3 task darwin:package ARCH=" + architecture
		signatureCheck := `codesign --verify --deep --strict "$APP_BUNDLE"`
		archiveCall := "wails3 task darwin:create:updater-archive ARCH=" + architecture
		conformanceCall := "GOARCH=" + architecture + " wails3 task release:validate-macos-updater"
		require.Contains(t, workflow, packageCall)
		require.Contains(t, workflow, archiveCall)
		require.Contains(t, workflow, conformanceCall)
		require.Less(t, strings.Index(workflow, packageCall), strings.Index(workflow, archiveCall))
		require.Less(t, strings.Index(workflow, signatureCheck), strings.Index(workflow, archiveCall))
		require.Less(t, strings.Index(workflow, archiveCall), strings.Index(workflow, conformanceCall))
	}
	require.Contains(t, workflow, `spctl --assess --type execute "$APP_BUNDLE"`)
	require.Contains(t, workflow, `xcrun stapler validate "$APP_BUNDLE"`)

	darwinTaskfile := readTestFile(t, repositoryPath("build", "darwin", "Taskfile.yml"))
	require.Contains(t, darwinTaskfile, "create:updater-archive:")
	require.Contains(t, darwinTaskfile, "ditto -c -k --keepParent")
	require.NotContains(t, darwinTaskfile, "--sequesterRsrc")

	rootTaskfile := readTestFile(t, repositoryPath("Taskfile.yml"))
	require.Contains(t, rootTaskfile, "release:validate-macos-updater:")
	require.Contains(t, rootTaskfile, "go run ./cmd/project validate-macos-updater")
}

func TestMacOSBundlesUseTheConfiguredProductName(t *testing.T) {
	rootTaskfile := readTestFile(t, repositoryPath("Taskfile.yml"))
	require.Contains(t, rootTaskfile, "sh: go run ./cmd/project product-name")

	darwinTaskfile := readTestFile(t, repositoryPath("build", "darwin", "Taskfile.yml"))
	require.Contains(t, darwinTaskfile, `{{.APP_PRODUCT_NAME}}.app`)
	require.NotContains(t, darwinTaskfile, `{{.APP_NAME}}.app`)
	require.Contains(
		t,
		darwinTaskfile,
		`cp "{{.BIN_DIR}}/{{.APP_NAME}}" "{{.BIN_DIR}}/{{.APP_PRODUCT_NAME}}.app/Contents/MacOS"`,
	)
	require.Contains(t, darwinTaskfile, `--name "{{.APP_PRODUCT_NAME}}"`)

	workflow := readTestFile(t, repositoryPath(".github", "workflows", "release.yml"))
	require.Contains(t, workflow, `APP_PRODUCT_NAME="$(go run ./cmd/project product-name)"`)
	require.Contains(t, workflow, `APP_BUNDLE="bin/${APP_PRODUCT_NAME}.app"`)
	require.Contains(t, workflow, `APP_DMG="bin/${APP_PRODUCT_NAME}.dmg"`)
	require.NotContains(t, workflow, "bin/luxury-yacht.app")
}

func TestReleasePublishesSignedUpdaterManifestInsideTheGitHubRelease(t *testing.T) {
	workflow := readTestFile(t, repositoryPath(".github", "workflows", "release.yml"))
	materialize := strings.Index(workflow, "Materialize updater signing key")
	prepare := strings.Index(workflow, "wails3 task release:prepare-updater-manifest")
	publishRelease := strings.Index(workflow, "wails3 task release:app")
	cleanup := strings.Index(workflow, "Remove updater signing key")
	require.GreaterOrEqual(t, materialize, 0)
	require.Greater(t, prepare, materialize)
	require.Greater(t, publishRelease, prepare)
	require.Greater(t, cleanup, prepare)
	require.Contains(t, workflow, "UPDATER_PRIVATE_KEY_PEM: ${{ secrets.UPDATER_PRIVATE_KEY_PEM }}")
	require.Contains(t, workflow, `if: ${{ always() }}`)
	require.Contains(t, workflow, "UPDATER_TARGETS: darwin/arm64,darwin/amd64")
	require.Contains(t, workflow, "UPDATER_ARTIFACTS_DIR: ./artifacts")
	require.NotContains(t, workflow, "updater-manifests")
	require.NotContains(t, workflow, "release:publish-updater-channels")
	require.NotContains(t, workflow, "update-publication")

	rootTaskfile := readTestFile(t, repositoryPath("Taskfile.yml"))
	require.Contains(t, rootTaskfile, "release:prepare-updater-manifest:")
	require.NotContains(t, rootTaskfile, "release:publish-updater-channels:")
}

func TestRefreshTransportUsesOnlyWailsServiceAndNamedStreams(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	require.Contains(t, mainSource, `application.ServiceOptions{Route: "/api/v2"}`)
	require.Contains(t, mainSource, `wailsApp.HandleStream(backend.RefreshResourceStreamName`)
	require.Contains(t, mainSource, `wailsApp.HandleStream(backend.RefreshContainerLogsStreamName`)

	appSource := readTestFile(t, repositoryPath("backend", "app.go"))
	require.NotContains(t, appSource, `HandleStream(`)
	require.NotContains(t, appSource, "net.Listen")
	require.NotContains(t, appSource, "refreshHTTPServer")
	require.NotContains(t, appSource, "refreshListener")

	clientSource := readTestFile(t, repositoryPath("frontend", "src", "core", "refresh", "client.ts"))
	require.NotContains(t, clientSource, "GetRefreshBaseURL")
	require.NotContains(t, clientSource, "refreshBaseURL")

	resourceStreamSource := readTestFile(t, repositoryPath("frontend", "src", "core", "refresh", "streaming", "resourceStreamConnection.ts"))
	require.Contains(t, resourceStreamSource, "JSONStream")
	require.NotContains(t, resourceStreamSource, "new WebSocket")

	containerLogsSource := readTestFile(t, repositoryPath("frontend", "src", "core", "refresh", "streaming", "containerLogsStreamManager.ts"))
	require.Contains(t, containerLogsSource, "JSONStream")
	require.NotContains(t, containerLogsSource, "EventSource")

	apiSource := readTestFile(t, repositoryPath("backend", "refresh", "api", "server.go"))
	require.NotContains(t, apiSource, `"/api/v2/`)
	require.NotContains(t, apiSource, "Access-Control-Allow")

	for _, path := range []string{
		"backend/app_refresh.go",
		"backend/refresh_stream_cors.go",
		"frontend/src/core/refresh/streaming/sseStreamTransport.ts",
	} {
		_, err := os.Stat(repositoryPath(strings.Split(path, "/")...))
		require.ErrorIsf(t, err, os.ErrNotExist, "%s must remain absent", path)
	}
}

func TestProjectCommandOwnsItsImplementation(t *testing.T) {
	for _, path := range []string{
		"app_state.go",
		"build_metadata.go",
		"clean.go",
		"command.go",
		"go_modules.go",
		"install_unsigned.go",
		"platform_manifests.go",
		"project_config.go",
		"quality.go",
		"release.go",
		"updater_release.go",
		"wails_bindings.go",
		"windows_version.go",
	} {
		_, err := os.Stat(repositoryPath("cmd", "project", path))
		require.NoError(t, err)
	}

	for _, path := range []string{
		"internal/projecttools",
		"cmd/windowsversion",
		"cmd/project/build_config.go",
		"cmd/project/dotenv.go",
		"cmd/project/github.go",
		"cmd/project/gomod.go",
		"cmd/project/utils.go",
	} {
		_, err := os.Stat(repositoryPath(path))
		require.ErrorIs(t, err, os.ErrNotExist)
	}

	manifestRenderer := readTestFile(t, repositoryPath("cmd", "project", "platform_manifests.go"))
	require.Contains(t, manifestRenderer, "windowsNumericVersion(metadata.Info.Version)")
}

func TestProjectCommandHasNoExportedGoDeclarations(t *testing.T) {
	projectDir := repositoryPath("cmd", "project")
	files, err := filepath.Glob(filepath.Join(projectDir, "*.go"))
	require.NoError(t, err)

	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		require.NoError(t, err)
		for _, declaration := range parsed.Decls {
			switch declaration := declaration.(type) {
			case *ast.FuncDecl:
				if declaration.Name.Name != "main" {
					require.Falsef(t, declaration.Name.IsExported(), "%s exports %s", path, declaration.Name.Name)
				}
			case *ast.GenDecl:
				for _, spec := range declaration.Specs {
					if typeSpec, ok := spec.(*ast.TypeSpec); ok {
						require.Falsef(t, typeSpec.Name.IsExported(), "%s exports %s", path, typeSpec.Name.Name)
					}
				}
			}
		}
	}
}
