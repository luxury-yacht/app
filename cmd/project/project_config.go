package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/windowsinstall"
	"gopkg.in/yaml.v3"
)

const (
	projectAppShortName = "luxury-yacht"
	projectArtifactsDir = "artifacts"
	projectBuildDir     = "build"
	projectConfigPath   = "build/config.yml"
	projectEnvPath      = ".env"
	projectFrontendDir  = "frontend"
	projectManifestPath = "backend/buildinfo/generated.json"
	projectPackagePath  = "github.com/luxury-yacht/app"
	projectReleaseRepo  = "luxury-yacht/app"
)

var projectReleaseAssets = []string{".deb", ".rpm", ".dmg", ".exe", ".tar.gz", ".zip"}

type projectMetadata struct {
	Info struct {
		CompanyName       string `yaml:"companyName"`
		ProductName       string `yaml:"productName"`
		ProductIdentifier string `yaml:"productIdentifier"`
		Description       string `yaml:"description"`
		Copyright         string `yaml:"copyright"`
		Comments          string `yaml:"comments"`
		Version           string `yaml:"version"`
	} `yaml:"info"`
	LuxuryYacht struct {
		BetaExpiryDays int      `yaml:"betaExpiryDays"`
		Maintainer     string   `yaml:"maintainer"`
		UpdaterTargets []string `yaml:"updaterTargets"`
	} `yaml:"luxuryYacht"`
}

type projectFacts struct {
	betaExpiry string
	commit     string
	isBeta     bool
	version    string
}

type projectConfigOutput struct {
	AppShortName                 string
	ArtifactsDir                 string
	BetaExpiry                   string
	BuildDir                     string
	FrontendDir                  string
	Commit                       string
	IsBeta                       bool
	ManifestPath                 string
	PackagePath                  string
	ProductName                  string
	ReleaseAssets                []string
	ReleaseRepo                  string
	Version                      string
	WindowsUninstallRegistryPath string
}

func loadDotEnv(path string) error {
	if err := godotenv.Load(path); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("load environment from %s: %w", path, err)
	}
	return nil
}

func readProjectMetadata(path string) (projectMetadata, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return projectMetadata{}, fmt.Errorf("read Wails config %s: %w", path, err)
	}
	var metadata projectMetadata
	if err := yaml.Unmarshal(data, &metadata); err != nil {
		return projectMetadata{}, fmt.Errorf("parse Wails config %s: %w", path, err)
	}
	if strings.TrimSpace(metadata.Info.Version) == "" {
		return projectMetadata{}, fmt.Errorf("wails config %s has no info.version", path)
	}
	return metadata, nil
}

func loadProjectFacts() (projectFacts, error) {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return projectFacts{}, err
	}
	return deriveProjectFacts(metadata, time.Now().UTC(), gitRevParse()), nil
}

func deriveProjectFacts(metadata projectMetadata, now time.Time, commit string) projectFacts {
	version := strings.TrimSpace(metadata.Info.Version)
	beta := isBetaVersion(version)
	betaExpiryDays := 0
	if beta {
		betaExpiryDays = metadata.LuxuryYacht.BetaExpiryDays
	}
	return projectFacts{
		betaExpiry: now.AddDate(0, 0, betaExpiryDays).Format(time.RFC3339),
		commit:     strings.TrimSpace(commit),
		isBeta:     beta,
		version:    version,
	}
}

func isBetaVersion(version string) bool {
	release, err := updateidentity.ParseReleaseVersion(version)
	return err == nil && release.Channel == updateidentity.ChannelBeta
}

func writeProjectConfig(output io.Writer) error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read app version: %w", err)
	}
	facts := deriveProjectFacts(metadata, time.Now().UTC(), gitRevParse())
	registryPath, err := windowsUninstallRegistryPath(metadata)
	if err != nil {
		return fmt.Errorf("derive Windows uninstall registration: %w", err)
	}
	config := projectConfigOutput{
		AppShortName:                 projectAppShortName,
		ArtifactsDir:                 projectArtifactsDir,
		BetaExpiry:                   facts.betaExpiry,
		BuildDir:                     projectBuildDir,
		FrontendDir:                  projectFrontendDir,
		Commit:                       facts.commit,
		IsBeta:                       facts.isBeta,
		ManifestPath:                 projectManifestPath,
		PackagePath:                  projectPackagePath,
		ProductName:                  strings.TrimSpace(metadata.Info.ProductName),
		ReleaseAssets:                projectReleaseAssets,
		ReleaseRepo:                  projectReleaseRepo,
		Version:                      facts.version,
		WindowsUninstallRegistryPath: registryPath,
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(config)
}

func windowsUninstallRegistryPath(metadata projectMetadata) (string, error) {
	return windowsinstall.RegistryPath(metadata.Info.CompanyName, metadata.Info.ProductName)
}

func projectBinaryName(metadata projectMetadata) (string, error) {
	productName, err := projectProductName(metadata)
	if err != nil {
		return "", err
	}
	return strings.ToLower(strings.ReplaceAll(productName, " ", "-")), nil
}

func projectProductName(metadata projectMetadata) (string, error) {
	productName := strings.TrimSpace(metadata.Info.ProductName)
	if productName == "" {
		return "", fmt.Errorf("wails config has no info.productName")
	}
	return productName, nil
}

func releaseArtifactName(metadata projectMetadata, goos, goarch, format string) (string, error) {
	name, err := projectBinaryName(metadata)
	if err != nil {
		return "", err
	}
	version := strings.TrimSpace(metadata.Info.Version)
	if version == "" {
		return "", fmt.Errorf("wails config has no info.version")
	}
	goos = strings.ToLower(strings.TrimSpace(goos))
	goarch = strings.ToLower(strings.TrimSpace(goarch))
	format = strings.ToLower(strings.TrimSpace(format))
	if format == "updater" {
		return updaterArtifactName(metadata, goos, goarch)
	}

	var artifactName string
	switch goos {
	case "darwin":
		artifactName = darwinReleaseArtifactName(name, version, goarch, format)
	case "linux":
		artifactName = linuxReleaseArtifactName(name, version, goarch, format)
	case "windows":
		artifactName = windowsReleaseArtifactName(name, version, goarch, format)
	}
	if artifactName != "" {
		return artifactName, nil
	}

	return "", fmt.Errorf("unsupported release artifact target %s/%s format %s", goos, goarch, format)
}

func darwinReleaseArtifactName(name, version, goarch, format string) string {
	if format != "dmg" || !isReleaseArchitecture(goarch) {
		return ""
	}
	return fmt.Sprintf("%s-%s-macos-%s.dmg", name, version, goarch)
}

func linuxReleaseArtifactName(name, version, goarch, format string) string {
	if format == "portable" && isReleaseArchitecture(goarch) {
		return fmt.Sprintf("%s-%s-linux-%s-portable.tar.gz", name, version, goarch)
	}
	if format == "deb" && isReleaseArchitecture(goarch) {
		return fmt.Sprintf("%s_%s_linux_%s.deb", name, version, goarch)
	}
	rpmArch := map[string]string{"amd64": "x86_64", "arm64": "aarch64"}[goarch]
	if format == "rpm" && rpmArch != "" {
		return fmt.Sprintf("%s-%s-linux-%s.rpm", name, version, rpmArch)
	}
	return ""
}

func windowsReleaseArtifactName(name, version, goarch, format string) string {
	if !isReleaseArchitecture(goarch) {
		return ""
	}
	scope := "user"
	if format == "system-exe" {
		scope = "system"
	} else if format != "exe" {
		return ""
	}
	return fmt.Sprintf("%s-%s-windows-%s-%s-installer.exe", name, version, goarch, scope)
}

func isReleaseArchitecture(goarch string) bool {
	return goarch == "amd64" || goarch == "arm64"
}

func updaterArtifactName(metadata projectMetadata, goos, goarch string) (string, error) {
	name, err := projectBinaryName(metadata)
	if err != nil {
		return "", err
	}
	version := strings.TrimSpace(metadata.Info.Version)
	if _, err := updateidentity.ParseReleaseVersion(version); err != nil {
		return "", err
	}
	goos = strings.ToLower(strings.TrimSpace(goos))
	goarch = strings.ToLower(strings.TrimSpace(goarch))
	if !isReleaseArchitecture(goarch) {
		return "", fmt.Errorf("unsupported updater artifact target %s/%s", goos, goarch)
	}

	switch goos {
	case "darwin":
		return fmt.Sprintf("%s-%s-darwin-%s.zip", name, version, goarch), nil
	case "windows":
		return fmt.Sprintf("%s-%s-windows-%s.exe", name, version, goarch), nil
	case "linux":
		return fmt.Sprintf("%s-%s-linux-%s-updater.tar.gz", name, version, goarch), nil
	default:
		return "", fmt.Errorf("unsupported updater artifact target %s/%s", goos, goarch)
	}
}
