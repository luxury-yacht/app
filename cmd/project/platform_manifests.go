package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	appCommentsPlaceholder    = "__APP_COMMENTS__"
	appBinaryNamePlaceholder  = "__APP_BINARY_NAME__"
	appCompanyPlaceholder     = "__APP_COMPANY__"
	appCopyrightPlaceholder   = "__APP_COPYRIGHT__"
	appDescriptionPlaceholder = "__APP_DESCRIPTION__"
	appIdentifierPlaceholder  = "__APP_IDENTIFIER__"
	appNamePlaceholder        = "__APP_NAME__"
	appVersionPlaceholder     = "__APP_VERSION__"
	windowsVersionPlaceholder = "__WINDOWS_VERSION__"
)

type platformManifestSpec struct {
	outputPath string
	sourcePath string
}

var projectPlatformManifestSpecs = []platformManifestSpec{
	{
		sourcePath: filepath.Join("build", "darwin", "Info.plist"),
		outputPath: filepath.Join("bin", "build-manifests", "darwin", "Info.plist"),
	},
	{
		sourcePath: filepath.Join("build", "darwin", "Info.dev.plist"),
		outputPath: filepath.Join("bin", "build-manifests", "darwin", "Info.dev.plist"),
	},
	{
		sourcePath: filepath.Join("build", "linux", "nfpm", "nfpm.yaml"),
		outputPath: filepath.Join("bin", "build-manifests", "linux", "nfpm.yaml"),
	},
	{
		sourcePath: filepath.Join("build", "linux", "desktop"),
		outputPath: filepath.Join("bin", "build-manifests", "linux", "app.desktop"),
	},
	{
		sourcePath: filepath.Join("build", "windows", "wails.exe.manifest"),
		outputPath: filepath.Join("bin", "build-manifests", "windows", "wails.exe.manifest"),
	},
	{
		sourcePath: filepath.Join("build", "windows", "info.json"),
		outputPath: filepath.Join("bin", "build-manifests", "windows", "info.json"),
	},
	{
		sourcePath: filepath.Join("build", "windows", "nsis", "project_metadata.nsh"),
		outputPath: filepath.Join("bin", "build-manifests", "windows", "nsis", "project_metadata.nsh"),
	},
}

type platformManifestReplacement struct {
	configKey   string
	placeholder string
	value       string
}

type renderedPlatformManifest struct {
	contents   []byte
	outputPath string
}

func renderProjectPlatformManifests(configPath string, specs []platformManifestSpec) error {
	metadata, err := readProjectMetadata(configPath)
	if err != nil {
		return err
	}
	replacements, err := platformManifestReplacements(metadata)
	if err != nil {
		return fmt.Errorf("read platform manifest metadata from %s: %w", configPath, err)
	}

	rendered := make([]renderedPlatformManifest, 0, len(specs))
	for _, spec := range specs {
		contents, err := os.ReadFile(spec.sourcePath)
		if err != nil {
			return fmt.Errorf("read platform manifest template %s: %w", spec.sourcePath, err)
		}
		result := string(contents)
		hasPlaceholder := false
		for _, replacement := range replacements {
			if strings.Contains(result, replacement.placeholder) {
				hasPlaceholder = true
				result = strings.ReplaceAll(result, replacement.placeholder, replacement.value)
			}
		}
		if !hasPlaceholder {
			return fmt.Errorf("platform manifest template %s has no project metadata placeholder", spec.sourcePath)
		}
		rendered = append(rendered, renderedPlatformManifest{
			contents:   []byte(result),
			outputPath: spec.outputPath,
		})
	}

	for _, manifest := range rendered {
		if err := os.MkdirAll(filepath.Dir(manifest.outputPath), 0o755); err != nil {
			return fmt.Errorf("create platform manifest directory for %s: %w", manifest.outputPath, err)
		}
		if err := os.WriteFile(manifest.outputPath, manifest.contents, 0o644); err != nil {
			return fmt.Errorf("write platform manifest %s: %w", manifest.outputPath, err)
		}
	}
	return nil
}

func platformManifestReplacements(metadata projectMetadata) ([]platformManifestReplacement, error) {
	binaryName, err := projectBinaryName(metadata)
	if err != nil {
		return nil, err
	}
	windowsVersion, err := windowsNumericVersion(metadata.Info.Version)
	if err != nil {
		return nil, err
	}
	replacements := []platformManifestReplacement{
		{configKey: "info.productName", placeholder: appBinaryNamePlaceholder, value: binaryName},
		{configKey: "info.comments", placeholder: appCommentsPlaceholder, value: metadata.Info.Comments},
		{configKey: "info.companyName", placeholder: appCompanyPlaceholder, value: metadata.Info.CompanyName},
		{configKey: "info.copyright", placeholder: appCopyrightPlaceholder, value: metadata.Info.Copyright},
		{configKey: "info.description", placeholder: appDescriptionPlaceholder, value: metadata.Info.Description},
		{configKey: "info.productIdentifier", placeholder: appIdentifierPlaceholder, value: metadata.Info.ProductIdentifier},
		{configKey: "info.productName", placeholder: appNamePlaceholder, value: metadata.Info.ProductName},
		{configKey: "info.version", placeholder: appVersionPlaceholder, value: metadata.Info.Version},
		{configKey: "info.version", placeholder: windowsVersionPlaceholder, value: windowsVersion},
	}
	for index := range replacements {
		replacements[index].value = strings.TrimSpace(replacements[index].value)
		if replacements[index].value == "" {
			return nil, fmt.Errorf("wails config has no %s", replacements[index].configKey)
		}
	}
	return replacements, nil
}
