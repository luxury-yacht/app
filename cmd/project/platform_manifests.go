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
	appMaintainerPlaceholder  = "__APP_MAINTAINER__"
	appNamePlaceholder        = "__APP_NAME__"
	appVersionPlaceholder     = "__APP_VERSION__"
	platformManifestDirectory = "build-manifests"
	windowsVersionPlaceholder = "__WINDOWS_VERSION__"
)

type platformManifestSpec struct {
	outputPath string
	sourcePath string
}

var projectPlatformManifestSpecs = []platformManifestSpec{
	{
		sourcePath: filepath.Join("build", "darwin", "Info.plist"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "darwin", "Info.plist"),
	},
	{
		sourcePath: filepath.Join("build", "darwin", "Info.dev.plist"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "darwin", "Info.dev.plist"),
	},
	{
		sourcePath: filepath.Join("build", "linux", "nfpm", "nfpm.yaml"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "linux", "nfpm.yaml"),
	},
	{
		sourcePath: filepath.Join("build", "linux", "desktop"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "linux", "app.desktop"),
	},
	{
		sourcePath: filepath.Join("build", "linux", "nfpm", "install-deb.json"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "linux", "install-deb.json"),
	},
	{
		sourcePath: filepath.Join("build", "linux", "nfpm", "install-rpm.json"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "linux", "install-rpm.json"),
	},
	{
		sourcePath: filepath.Join("build", "windows", "wails.exe.manifest"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "windows", "wails.exe.manifest"),
	},
	{
		sourcePath: filepath.Join("build", "windows", "info.json"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "windows", "info.json"),
	},
	{
		sourcePath: filepath.Join("build", "windows", "nsis", "project_metadata.nsh"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "windows", "nsis", "project_metadata.nsh"),
	},
	{
		sourcePath: filepath.Join("build", "windows", "nsis", "install-user.json"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "windows", "nsis", "install-user.json"),
	},
	{
		sourcePath: filepath.Join("build", "windows", "nsis", "install-machine.json"),
		outputPath: filepath.Join("bin", platformManifestDirectory, "windows", "nsis", "install-machine.json"),
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
		manifest, err := renderPlatformManifest(spec, replacements)
		if err != nil {
			return err
		}
		rendered = append(rendered, manifest)
	}

	for _, manifest := range rendered {
		if err := writePlatformManifest(manifest); err != nil {
			return err
		}
	}
	return nil
}

func renderPlatformManifest(spec platformManifestSpec, replacements []platformManifestReplacement) (renderedPlatformManifest, error) {
	contents, err := os.ReadFile(spec.sourcePath)
	if err != nil {
		return renderedPlatformManifest{}, fmt.Errorf("read platform manifest template %s: %w", spec.sourcePath, err)
	}
	result, hasPlaceholder := replacePlatformManifestMetadata(string(contents), replacements)
	if !hasPlaceholder {
		return renderedPlatformManifest{}, fmt.Errorf("platform manifest template %s has no project metadata placeholder", spec.sourcePath)
	}
	return renderedPlatformManifest{
		contents:   []byte(result),
		outputPath: spec.outputPath,
	}, nil
}

func replacePlatformManifestMetadata(contents string, replacements []platformManifestReplacement) (string, bool) {
	hasPlaceholder := false
	for _, replacement := range replacements {
		if strings.Contains(contents, replacement.placeholder) {
			hasPlaceholder = true
			contents = strings.ReplaceAll(contents, replacement.placeholder, replacement.value)
		}
	}
	return contents, hasPlaceholder
}

func writePlatformManifest(manifest renderedPlatformManifest) error {
	if err := os.MkdirAll(filepath.Dir(manifest.outputPath), 0o755); err != nil {
		return fmt.Errorf("create platform manifest directory for %s: %w", manifest.outputPath, err)
	}
	if err := os.WriteFile(manifest.outputPath, manifest.contents, 0o644); err != nil {
		return fmt.Errorf("write platform manifest %s: %w", manifest.outputPath, err)
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
		{configKey: "luxuryYacht.maintainer", placeholder: appMaintainerPlaceholder, value: metadata.LuxuryYacht.Maintainer},
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
