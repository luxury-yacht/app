package main

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWailsBindingsUseInterfaces(t *testing.T) {
	taskfile, err := os.ReadFile("build/Taskfile.yml")
	require.NoError(t, err)

	bindingCommand := "wails3 generate bindings"
	commandOffset := strings.Index(string(taskfile), bindingCommand)
	require.NotEqual(t, -1, commandOffset)
	commandLine := strings.Split(string(taskfile)[commandOffset:], "\n")[0]
	require.Contains(t, commandLine, " -i")
}

func TestWailsProjectUsesFreshInitBuildDefaults(t *testing.T) {
	rootTaskfile, err := os.ReadFile("Taskfile.yml")
	require.NoError(t, err)
	require.Contains(t, string(rootTaskfile), `BIN_DIR: "bin"`)
	require.Contains(t, string(rootTaskfile), `PACKAGE_MANAGER: '{{.PACKAGE_MANAGER | default "npm"}}'`)
	require.Contains(t, string(rootTaskfile), `VITE_PORT: '{{.WAILS_VITE_PORT | default 9245}}'`)

	config, err := os.ReadFile("build/config.yml")
	require.NoError(t, err)
	require.NotContains(t, string(config), "build/bin")
}

func TestWailsBuildPreparesProjectMetadataWithoutMage(t *testing.T) {
	taskfile, err := os.ReadFile("build/Taskfile.yml")
	require.NoError(t, err)
	require.Contains(t, string(taskfile), "prepare:build:")
	require.Contains(t, string(taskfile), "go run ./cmd/buildmeta")
	require.Contains(t, string(taskfile), "task: prepare:build")
	require.NotContains(t, string(taskfile), "mage build-assets")
}

func TestWailsProjectGeneratesModernMacOSIconAssets(t *testing.T) {
	taskfile, err := os.ReadFile("build/Taskfile.yml")
	require.NoError(t, err)
	require.Contains(t, string(taskfile), "-iconcomposerinput appicon.icon")
	require.Contains(t, string(taskfile), "-macassetdir darwin")

	iconConfig, err := os.ReadFile("build/appicon.icon/icon.json")
	require.NoError(t, err)
	require.Contains(t, string(iconConfig), `"image-name" : "captain-k8s-color.png"`)

	icon, err := os.ReadFile("build/appicon.icon/Assets/captain-k8s-color.png")
	require.NoError(t, err)
	legacyIcon, err := os.ReadFile("build/appicon.png")
	require.NoError(t, err)
	require.Equal(t, legacyIcon, icon)
}
