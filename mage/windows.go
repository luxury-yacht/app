package mage

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"

	"github.com/magefile/mage/sh"
)

func BuildWindows(cfg BuildConfig) error {
	// Ensure Wails uses the intended app icon when generating Windows resources.
	if err := prepareWindowsBuildIcon(cfg); err != nil {
		return err
	}

	generateBuildManifest(cfg)

	// Update build args for Windows
	cfg.BuildArgs = append(cfg.BuildArgs, "-o", cfg.AppShortName+".exe")

	return sh.RunV("wails", cfg.BuildArgs...)
}

// Annoyingly, Windows won't accept semver strings with prerelease or build metadata.
func sanitizeSemverForWindows(semver string) (string, error) {
    fmt.Printf("\n⚙️ Sanitizing semver %s for Windows...\n", semver)

	re := regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$`)
	m := re.FindStringSubmatch(semver)
	if m == nil {
		return "", fmt.Errorf("invalid semver: %s", semver)
	}

	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])

	build := 1000 // default for stable releases

	// prerelease present
	if m[4] != "" {
		// try to extract trailing number (beta.5, rc.12, etc)
		numRe := regexp.MustCompile(`(\d+)$`)
		if n := numRe.FindStringSubmatch(m[4]); n != nil {
			build, _ = strconv.Atoi(n[1])
		} else {
			build = 0
		}
	}

	sanitizedVersion := fmt.Sprintf("%d.%d.%d.%d", major, minor, patch, build)
	fmt.Printf("✅ Sanitized version: %s\n", sanitizedVersion)
	return sanitizedVersion, nil
}

// buildWindowsInstaller runs Wails with NSIS enabled to generate the installer.
func buildWindowsInstaller(cfg BuildConfig) error {
	// Keep the Windows icon and build metadata in sync before generating the installer.
	if err := prepareWindowsBuildIcon(cfg); err != nil {
		return err
	}

	generateBuildManifest(cfg)

	normalizedVersion, err := sanitizeSemverForWindows(cfg.Version)
	if err != nil {
		return err
	}

	buildArgs := append([]string{}, cfg.BuildArgs...)
	buildArgs = append(buildArgs, "-o", cfg.AppShortName+".exe", "-nsis")
	// Provide a normalized version for the NSIS template without touching wails.json.
	return sh.RunWithV(map[string]string{
		"LY_NSIS_VERSION": normalizedVersion,
	}, "wails", buildArgs...)
}

// prepareWindowsBuildIcon stages the PNG source and clears stale ICOs so Wails regenerates the icon.
func prepareWindowsBuildIcon(cfg BuildConfig) error {
	fmt.Println("\n🎨 Preparing Windows .ico file...")

	if _, err := os.Stat(cfg.IconSource); err != nil {
		return fmt.Errorf("icon not found at %s: %w", cfg.IconSource, err)
	}

	if err := os.MkdirAll(cfg.BuildDir, 0o755); err != nil {
		return fmt.Errorf("failed to create build dir: %w", err)
	}

	iconDest := filepath.Join(cfg.BuildDir, "appicon.png")
	if err := sh.Copy(iconDest, cfg.IconSource); err != nil {
		return fmt.Errorf("failed to copy icon for Windows build: %w", err)
	}

	// Remove the cached ICO so Wails regenerates it from the updated PNG.
	windowsIcon := filepath.Join(cfg.BuildDir, "windows", "icon.ico")
	if err := os.Remove(windowsIcon); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove stale Windows icon: %w", err)
	}

	fmt.Println("✅ Icon file staged at", iconDest)

	return nil
}

// Determines the Windows install root directory.
// Typically: %LOCALAPPDATA%\Programs\<AppLongName>
func getWindowsInstallRoot(cfg BuildConfig) (string, error) {
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		return filepath.Join(localAppData, "Programs", cfg.AppLongName), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to resolve Windows install root: %w", err)
	}
	return filepath.Join(home, cfg.AppLongName), nil
}

// Stages the Windows application payload for packaging.
func stageWindowsPayload(cfg BuildConfig, binPath string) (string, error) {
	packagesDir := filepath.Join(cfg.BuildDir, "packages", "windows")
	stageDir := filepath.Join(packagesDir, fmt.Sprintf("%s-%s-%s", cfg.AppShortName, cfg.Version, cfg.ArchType))

	// Clear out any existing staging directory.
	if err := os.RemoveAll(stageDir); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("failed to clear staging dir: %w", err)
	}

	// Create the staging directory.
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create staging dir: %w", err)
	}

	// Copy the binary into the staging directory.
	binDest := filepath.Join(stageDir, cfg.AppShortName+".exe")
	if err := sh.Copy(binDest, binPath); err != nil {
		return "", fmt.Errorf("failed to copy binary into staging dir: %w", err)
	}

	return stageDir, nil
}

func getWindowsBinaryPath(cfg BuildConfig) string {
	return filepath.Join(cfg.BuildDir, "bin", cfg.AppShortName+".exe")
}

// Install the app locally, with optional signing.
func InstallWindows(cfg BuildConfig, signed bool) error {
	// Verify the binary exists.
	binPath := getWindowsBinaryPath(cfg)
	if _, err := os.Stat(binPath); err != nil {
		return fmt.Errorf("windows binary not found at %s: %w", binPath, err)
	}

	installDir, err := getWindowsInstallRoot(cfg)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return fmt.Errorf("failed to create install dir: %w", err)
	}
	destPath := filepath.Join(installDir, cfg.AppShortName+".exe")
	if err := sh.Copy(destPath, binPath); err != nil {
		return fmt.Errorf("failed to install binary: %w", err)
	}
	fmt.Printf("\n✅ Successfully installed %s to %s\n", cfg.AppLongName, destPath)
	return nil
}

// Package the app for release, with optional signing.
func PackageWindows(cfg BuildConfig, signed bool) error {
	// Generate the NSIS installer alongside the packaged zip.
	if err := buildWindowsInstaller(cfg); err != nil {
		return err
	}

	binPath := getWindowsBinaryPath(cfg)
	if _, err := os.Stat(binPath); err != nil {
		return fmt.Errorf("windows binary not found at %s: %w", binPath, err)
	}

	stageDir, err := stageWindowsPayload(cfg, binPath)
	if err != nil {
		return err
	}
	defer os.RemoveAll(stageDir)

	artifactName := fmt.Sprintf("%s-%s-windows-%s.zip", cfg.AppShortName, cfg.Version, cfg.ArchType)
	artifactPath := filepath.Join(cfg.ArtifactsDir, artifactName)
	if err := createZipFromDir(stageDir, artifactPath); err != nil {
		return err
	}
	return nil
}
