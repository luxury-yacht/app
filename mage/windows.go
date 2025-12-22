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

// Annoyingly, Windows won't accept semver strings with prepended `v` or prerelease/build metadata.
// This function converts semver into the Windows-compatible format of MAJOR.MINOR.PATCH.BUILD
// For beta releases, we extract the trailing number from the prerelease tag to use as the build number.
// For stable releases, we append a build number of 1000 so it takes precedence over prerelease versions.
// Examples:
//   v1.2.3        -> 1.2.3.1000
//   v1.2.3-beta.5 -> 1.2.3.5
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

	// Sanitize the version for Windows installer.
	normalizedVersion, err := sanitizeSemverForWindows(cfg.Version)
	if err != nil {
		return err
	}

	// Patch the generated NSIS template to use the normalized version.
	if err := patchGeneratedNSISTemplate(cfg, normalizedVersion); err != nil {
		return err
	}

	buildArgs := append([]string{}, cfg.BuildArgs...)
	buildArgs = append(buildArgs, "-o", cfg.AppShortName+".exe", "-nsis")
	return sh.RunV("wails", buildArgs...)
}

// patchGeneratedNSISTemplate updates the generated project.nsi to use a numeric version.
func patchGeneratedNSISTemplate(cfg BuildConfig, version string) error {
	projectPath := filepath.Join(cfg.BuildDir, "windows", "installer", "project.nsi")
	if _, err := os.Stat(projectPath); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("failed to stat NSIS project file at %s: %w", projectPath, err)
		}
		if err := stageWailsNSISTemplate(projectPath); err != nil {
			return err
		}
	}
	content, err := os.ReadFile(projectPath)
	if err != nil {
		return fmt.Errorf("failed to read NSIS project file at %s: %w", projectPath, err)
	}

	fmt.Printf("\n⚙️ Patching NSIS template with version %s...\n", version)

	// Replace the version strings.
	productRe := regexp.MustCompile(`(?m)^VIProductVersion\s+"[^"]+"\s*$`)
	fileRe := regexp.MustCompile(`(?m)^VIFileVersion\s+"[^"]+"\s*$`)

	if !productRe.Match(content) || !fileRe.Match(content) {
		return fmt.Errorf("NSIS project file missing VIProductVersion/VIFileVersion at %s", projectPath)
	}

	updated := productRe.ReplaceAllString(string(content), fmt.Sprintf(`VIProductVersion "%s"`, version))
	updated = fileRe.ReplaceAllString(updated, fmt.Sprintf(`VIFileVersion "%s"`, version))

	if err := os.WriteFile(projectPath, []byte(updated), 0o644); err != nil {
		return fmt.Errorf("failed to update NSIS project file at %s: %w", projectPath, err)
	}

	fmt.Println("✅ NSIS template patched successfully.")

	return nil
}

// stageWailsNSISTemplate seeds project.nsi from Wails' default template for clean builds.
func stageWailsNSISTemplate(destPath string) error {
	fmt.Println("\n📁 Staging Wails NSIS template...")

	wailsDir, err := sh.Output("go", "list", "-m", "-f", "{{.Dir}}", "github.com/wailsapp/wails/v2")
	if err != nil {
		return fmt.Errorf("failed to locate Wails module: %w", err)
	}
	sourcePath := filepath.Join(wailsDir, "pkg", "buildassets", "build", "windows", "installer", "project.nsi")
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return fmt.Errorf("failed to create NSIS template directory: %w", err)
	}
	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to read NSIS template from %s: %w", sourcePath, err)
	}
	if err := os.WriteFile(destPath, content, 0o644); err != nil {
		return fmt.Errorf("failed to write NSIS template to %s: %w", destPath, err)
	}
	fmt.Println("✅ Wails NSIS template staged at", destPath)
	return nil
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

func getWindowsBinaryPath(cfg BuildConfig) string {
	return filepath.Join(cfg.BuildDir, "bin", cfg.AppShortName+".exe")
}

func getWindowsInstallerPath(cfg BuildConfig) string {
	installerName := fmt.Sprintf("%s-%s-installer.exe", cfg.AppLongName, cfg.ArchType)
	return filepath.Join(cfg.BuildDir, "bin", installerName)
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
