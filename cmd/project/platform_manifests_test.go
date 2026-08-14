package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRenderProjectPlatformManifestsUsesConfigMetadata(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "config.yml")
	require.NoError(t, os.WriteFile(configPath, testPlatformMetadataConfig("9.8.7-beta.6"), 0o600))

	firstSource := filepath.Join(root, "first.template")
	secondSource := filepath.Join(root, "second.template")
	require.NoError(t, os.WriteFile(firstSource, []byte(
		appBinaryNamePlaceholder+"|"+
			appCompanyPlaceholder+"|"+
			appMaintainerPlaceholder+"|"+
			appNamePlaceholder+"|"+
			appIdentifierPlaceholder+"|"+
			appDescriptionPlaceholder+"|"+
			appCopyrightPlaceholder+"|"+
			appCommentsPlaceholder+"|"+
			windowsVersionPlaceholder,
	), 0o600))
	require.NoError(t, os.WriteFile(secondSource, []byte(appVersionPlaceholder+"/"+appVersionPlaceholder), 0o600))

	firstOutput := filepath.Join(root, "output", "first")
	secondOutput := filepath.Join(root, "output", "second")
	require.NoError(t, renderProjectPlatformManifests(configPath, []platformManifestSpec{
		{sourcePath: firstSource, outputPath: firstOutput},
		{sourcePath: secondSource, outputPath: secondOutput},
	}))

	first, err := os.ReadFile(firstOutput)
	require.NoError(t, err)
	require.Equal(t, "test-app|Test Company|Test Maintainer <maintainer@example.com>|Test App|app.test.desktop|Test description|Copyright Test|Test comments|9.8.7.6", string(first))
	second, err := os.ReadFile(secondOutput)
	require.NoError(t, err)
	require.Equal(t, "9.8.7-beta.6/9.8.7-beta.6", string(second))
}

func TestRenderNFPMManifestUsesConfiguredMaintainer(t *testing.T) {
	configPath := repositoryPath("build", "config.yml")
	metadata, err := readProjectMetadata(configPath)
	require.NoError(t, err)
	outputPath := filepath.Join(t.TempDir(), "nfpm.yaml")
	require.NoError(t, renderProjectPlatformManifests(
		configPath,
		[]platformManifestSpec{{
			sourcePath: repositoryPath("build", "linux", "nfpm", "nfpm.yaml"),
			outputPath: outputPath,
		}},
	))

	manifest := readTestFile(t, outputPath)
	require.Contains(t, manifest, `version: "`+metadata.Info.Version+`"`)
	require.Contains(t, manifest, `maintainer: "Luxury Yacht <info@luxury-yacht.app>"`)
	require.NotContains(t, manifest, appMaintainerPlaceholder)
	require.NotContains(t, manifest, "GIT_COMMITTER")
}

func TestRenderProjectPlatformManifestsRejectsTemplateWithoutMetadataPlaceholder(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "config.yml")
	require.NoError(t, os.WriteFile(configPath, testPlatformMetadataConfig("9.8.7"), 0o600))
	templatePath := filepath.Join(root, "manifest.template")
	require.NoError(t, os.WriteFile(templatePath, []byte("no version here"), 0o600))

	err := renderProjectPlatformManifests(configPath, []platformManifestSpec{{
		sourcePath: templatePath,
		outputPath: filepath.Join(root, "output"),
	}})

	require.ErrorContains(t, err, "has no project metadata placeholder")
}

func TestRenderProjectPlatformManifestsRejectsInvalidInputs(t *testing.T) {
	t.Run("config", func(t *testing.T) {
		root := t.TempDir()
		configPath := filepath.Join(root, "config.yml")
		require.NoError(t, os.WriteFile(configPath, []byte("info: {}\n"), 0o600))

		err := renderProjectPlatformManifests(configPath, nil)

		require.ErrorContains(t, err, "has no info.version")
	})

	t.Run("missing metadata", func(t *testing.T) {
		root := t.TempDir()
		configPath := filepath.Join(root, "config.yml")
		config := strings.ReplaceAll(string(testPlatformMetadataConfig("9.8.7")), "  productName: Test App\n", "")
		require.NoError(t, os.WriteFile(configPath, []byte(config), 0o600))

		err := renderProjectPlatformManifests(configPath, nil)

		require.ErrorContains(t, err, "wails config has no info.productName")
	})

	t.Run("missing maintainer", func(t *testing.T) {
		root := t.TempDir()
		configPath := filepath.Join(root, "config.yml")
		config := strings.ReplaceAll(string(testPlatformMetadataConfig("9.8.7")), "  maintainer: Test Maintainer <maintainer@example.com>\n", "")
		require.NoError(t, os.WriteFile(configPath, []byte(config), 0o600))

		err := renderProjectPlatformManifests(configPath, nil)

		require.ErrorContains(t, err, "wails config has no luxuryYacht.maintainer")
	})

	t.Run("missing template", func(t *testing.T) {
		root := t.TempDir()
		configPath := filepath.Join(root, "config.yml")
		require.NoError(t, os.WriteFile(configPath, testPlatformMetadataConfig("9.8.7"), 0o600))

		err := renderProjectPlatformManifests(configPath, []platformManifestSpec{{
			sourcePath: filepath.Join(root, "missing.template"),
			outputPath: filepath.Join(root, "output"),
		}})

		require.ErrorContains(t, err, "read platform manifest template")
	})

	t.Run("output directory", func(t *testing.T) {
		root := t.TempDir()
		configPath := filepath.Join(root, "config.yml")
		require.NoError(t, os.WriteFile(configPath, testPlatformMetadataConfig("9.8.7"), 0o600))
		templatePath := filepath.Join(root, "manifest.template")
		require.NoError(t, os.WriteFile(templatePath, []byte(appVersionPlaceholder), 0o600))
		blockedDirectory := filepath.Join(root, "blocked")
		require.NoError(t, os.WriteFile(blockedDirectory, []byte("file"), 0o600))

		err := renderProjectPlatformManifests(configPath, []platformManifestSpec{{
			sourcePath: templatePath,
			outputPath: filepath.Join(blockedDirectory, "manifest"),
		}})

		require.ErrorContains(t, err, "create platform manifest directory")
	})

	t.Run("output file", func(t *testing.T) {
		root := t.TempDir()
		configPath := filepath.Join(root, "config.yml")
		require.NoError(t, os.WriteFile(configPath, testPlatformMetadataConfig("9.8.7"), 0o600))
		templatePath := filepath.Join(root, "manifest.template")
		require.NoError(t, os.WriteFile(templatePath, []byte(appVersionPlaceholder), 0o600))
		outputDirectory := filepath.Join(root, "output")
		require.NoError(t, os.Mkdir(outputDirectory, 0o755))

		err := renderProjectPlatformManifests(configPath, []platformManifestSpec{{
			sourcePath: templatePath,
			outputPath: outputDirectory,
		}})

		require.ErrorContains(t, err, "write platform manifest")
	})
}

func testPlatformMetadataConfig(version string) []byte {
	return []byte(`info:
  companyName: Test Company
  productName: Test App
  productIdentifier: app.test.desktop
  description: Test description
  copyright: Copyright Test
  comments: Test comments
  version: ` + version + `
luxuryYacht:
  maintainer: Test Maintainer <maintainer@example.com>
`)
}
