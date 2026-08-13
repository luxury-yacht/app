package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
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
	require.Contains(t, mainSource, `applicationProductIdentifier = "app.luxury-yacht.desktop"`)
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
	registrySource := readTestFile(t, repositoryPath("workspace_window_registry.go"))
	require.Contains(t, registrySource, "Window.NewWithOptions")
	require.NotContains(t, strings.ToLower(registrySource), "spawnnewwindow")
}

func TestWailsApplicationIsInjectedDirectlyWithoutDesktopAdapter(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	require.Contains(t, mainSource, "backend.NewApp(wailsApp, reporter)")
	require.NotContains(t, mainSource, "NewAdapter")

	windowSource := readTestFile(t, repositoryPath("workspace_window_registry.go"))
	runtimeReadyHook := strings.Index(windowSource, "events.Common.WindowRuntimeReady")
	closingHook := strings.Index(windowSource, "events.Common.WindowClosing")
	runCall := strings.Index(mainSource, "composition.application.Run()")
	require.Positive(t, runtimeReadyHook)
	require.Positive(t, closingHook)
	require.Positive(t, runCall)

	runtimeSource := readTestFile(t, repositoryPath("backend", "app_runtime.go"))
	require.NotContains(t, runtimeSource, "type Desktop interface")

	menuSource := readTestFile(t, repositoryPath("backend", "menu.go"))
	require.NotContains(t, menuSource, "MenuModel")

	_, err := os.Stat(repositoryPath("internal", "desktop"))
	require.ErrorIs(t, err, os.ErrNotExist)
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

func TestReleaseArtifactsPreserveVersionPlatformAndArchitectureIdentity(t *testing.T) {
	workflow := readTestFile(t, repositoryPath(".github", "workflows", "release.yml"))
	require.Contains(t, workflow, "artifact_path: bin/*-macos-*.dmg")
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

func TestRefreshTransportUsesOnlyWailsServiceAndNamedStreams(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	require.Contains(t, mainSource, `application.ServiceOptions{Route: "/api/v2"}`)

	appSource := readTestFile(t, repositoryPath("backend", "app.go"))
	require.Contains(t, appSource, `HandleStream(refreshResourceStreamName`)
	require.Contains(t, appSource, `HandleStream(refreshContainerLogsStreamName`)
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
