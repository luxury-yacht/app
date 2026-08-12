package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
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

func TestWailsProjectUsesFrameworkSingleInstanceHandling(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	require.Contains(t, mainSource, "&application.SingleInstanceOptions{")
	require.Contains(t, mainSource, `applicationProductIdentifier = "app.luxury-yacht.desktop"`)
	require.Contains(t, mainSource, "mainWindow.Restore()")
	require.Contains(t, mainSource, "mainWindow.Focus()")
	require.NotContains(t, mainSource, "SecondLaunchCoordinator")

	buildConfig := readTestFile(t, repositoryPath("build", "config.yml"))
	require.Contains(t, buildConfig, `productIdentifier: "app.luxury-yacht.desktop"`)

	_, err := os.Stat(repositoryPath("internal", "desktop", "single_instance.go"))
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestWailsApplicationIsInjectedDirectlyWithoutDesktopAdapter(t *testing.T) {
	mainSource := readTestFile(t, repositoryPath("main.go"))
	require.Contains(t, mainSource, "backend.NewApp(wailsApp, reporter)")
	require.NotContains(t, mainSource, "NewAdapter")

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
}

func TestProjectCommandOwnsItsImplementation(t *testing.T) {
	for _, path := range []string{
		"app_state.go",
		"build_metadata.go",
		"clean.go",
		"command.go",
		"go_modules.go",
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

	windowsTaskfile := readTestFile(t, repositoryPath("build", "windows", "Taskfile.yml"))
	require.Contains(t, windowsTaskfile, "go run ./cmd/project windows-version")
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
