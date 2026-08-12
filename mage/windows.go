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
	return runWailsTask(cfg, "build")
}

// Annoyingly, Windows won't accept semver strings with prepended `v` or prerelease/build metadata.
// This function converts semver into the Windows-compatible format of MAJOR.MINOR.PATCH.BUILD
// For beta releases, we extract the trailing number from the prerelease tag to use as the build number.
// For stable releases, we append a build number of 1000 so it takes precedence over prerelease versions.
// Examples:
//
//	v1.2.3        -> 1.2.3.1000
//	v1.2.3-beta.5 -> 1.2.3.5
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

// buildWindowsInstaller runs the Wails v3 NSIS package task and copies the
// versioned release artifact into the repository's release staging directory.
func buildWindowsInstaller(cfg BuildConfig) error {
	if err := os.MkdirAll(cfg.ArtifactsDir, 0o755); err != nil {
		return fmt.Errorf("failed to prepare artifacts directory: %w", err)
	}
	normalizedVersion, err := sanitizeSemverForWindows(cfg.Version)
	if err != nil {
		return err
	}
	if err := runWailsTask(cfg, "package", "WINDOWS_VERSION="+normalizedVersion); err != nil {
		return err
	}
	builtInstaller := filepath.Join(
		cfg.BuildDir,
		"bin",
		fmt.Sprintf("%s-%s-installer.exe", cfg.AppShortName, cfg.ArchType),
	)
	if err := sh.Copy(getWindowsInstallerPath(cfg), builtInstaller); err != nil {
		return fmt.Errorf("stage Windows installer artifact: %w", err)
	}
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

func getWindowsBinaryPath(cfg BuildConfig) string {
	return filepath.Join(cfg.BuildDir, "bin", cfg.AppShortName+".exe")
}

func getWindowsInstallerPath(cfg BuildConfig) string {
	// Keep the path in sync with the NSIS OutFile format.
	installerName := fmt.Sprintf("%s-%s-windows-%s-installer.exe", cfg.AppShortName, cfg.Version, cfg.ArchType)
	return filepath.Join(cfg.ArtifactsDir, installerName)
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
	// Generate the NSIS installer.
	if err := buildWindowsInstaller(cfg); err != nil {
		return err
	}

	installerPath := getWindowsInstallerPath(cfg)
	if _, err := os.Stat(installerPath); err != nil {
		return fmt.Errorf("windows installer not found at %s: %w", installerPath, err)
	}

	// Remove the compiled binary so the installer is the only build/bin artifact.
	binPath := getWindowsBinaryPath(cfg)
	if err := os.Remove(binPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove windows binary at %s: %w", binPath, err)
	}
	return nil
}
