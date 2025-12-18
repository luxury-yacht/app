package mage

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/magefile/mage/sh"
)

// Check which version of webkit2gtk is installed.
func WebkitVersion() (string, error) {
	if _, err := exec.LookPath("pkg-config"); err != nil {
		return "", fmt.Errorf("pkg-config not found in PATH")
	}

	versions := []string{"4.0", "4.1"}

	for _, v := range versions {
		cmd := exec.Command("pkg-config", "--exists", "webkit2gtk-"+v)
		if err := cmd.Run(); err == nil {
			return v, nil
		}
	}
	fmt.Println("❌ No webkit2gtk version detected!")
	return "", fmt.Errorf("no webkit2gtk version detected")
}

// Builds the application for Linux.
func BuildLinux(cfg BuildConfig) error {
	generateBuildManifest(cfg)

	buildArgs := cfg.BuildArgs
	webkitVersion, err := WebkitVersion()
	if err != nil {
		return err
	}
	if webkitVersion == "4.1" {
		buildArgs = append(buildArgs, "-tags", "webkit2_41")
	}

	fmt.Printf("\n🛠️ Wails build args: %v\n\n", buildArgs)

	return sh.RunV("wails", buildArgs...)
}

// Installs the application on Linux.
func InstallLinux(cfg BuildConfig) error {
	// Verify the build artifact exists.
	binPath := getLinuxBinaryPath(cfg)
	if _, err := os.Stat(binPath); err != nil {
		return fmt.Errorf("linux binary not found at %s: %w", binPath, err)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get user home directory: %v", err)
	}

	// Create the install directory if it doesn't exist
	installDir := filepath.Join(homeDir, ".local", "bin")
	err = os.MkdirAll(installDir, os.ModePerm)
	if err != nil {
		return fmt.Errorf("failed to create install directory: %v", err)
	}

	installPath := filepath.Join(installDir, cfg.AppShortName)

	// Copy the built binary to the install location
	sourcePath := filepath.Join(cfg.BuildDir, "bin", cfg.AppShortName)
	err = sh.Copy(installPath, sourcePath)
	if err != nil {
		return fmt.Errorf("failed to install binary: %v", err)
	}

	fmt.Printf("\n✅ Successfully installed %s to %s\n", cfg.AppShortName, installPath)
	return nil
}

func installDesktopAssets(cfg BuildConfig, root string) error {
	// Make sure we don't unintentionally overwrite host files
	if strings.HasPrefix(root, "/usr") {
		return fmt.Errorf("refusing to stage desktop assets into system root: %s", root)
	}

	desktopDir := filepath.Join(root, "usr", "share", "applications")
	iconDir := filepath.Join(root, "usr", "share", "icons", "hicolor", "256x256", "apps")

	if err := os.MkdirAll(desktopDir, 0o755); err != nil {
		return fmt.Errorf("failed to create desktop dir: %w", err)
	}
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		return fmt.Errorf("failed to create icon dir: %w", err)
	}

	desktopPath := filepath.Join(desktopDir, fmt.Sprintf("%s.desktop", cfg.AppShortName))
	desktopTemplate := filepath.Join("mage", "deb", "desktop.tmpl")
	if err := renderDebTemplate(desktopTemplate, desktopPath, debTemplateData{
		AppShortName: cfg.AppShortName,
		AppLongName:  cfg.AppLongName,
	}, 0o644); err != nil {
		return fmt.Errorf("failed to render desktop entry: %w", err)
	}

	if _, err := os.Stat(cfg.IconSource); err != nil {
		return fmt.Errorf("icon not found at %s: %w", cfg.IconSource, err)
	}
	iconDest := filepath.Join(iconDir, fmt.Sprintf("%s.png", cfg.AppShortName))
	if err := sh.Copy(iconDest, cfg.IconSource); err != nil {
		return fmt.Errorf("failed to copy icon: %w", err)
	}

	return nil
}

// Make sure the dependencies for building .deb and .rpm are installed.
func CheckPackageDependencies() error {
	var missing []string

	if _, err := exec.LookPath("dpkg-deb"); err != nil {
		missing = append(missing, "dpkg-deb (install dpkg-dev)")
	}
	if _, err := exec.LookPath("rpmbuild"); err != nil {
		missing = append(missing, "rpmbuild (install rpm-build)")
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing packaging dependencies: %s", strings.Join(missing, ", "))
	}
	return nil
}

func getLinuxBinaryPath(cfg BuildConfig) string {
	return filepath.Join(cfg.BuildDir, "bin", cfg.AppShortName)
}

// Package the application for Linux.
// Creates .deb and .rpm artifacts in build/packages/.
func PackageLinux(cfg BuildConfig) error {
	// Verify the build artifact exists.
	binPath := getLinuxBinaryPath(cfg)
	if _, err := os.Stat(binPath); err != nil {
		return fmt.Errorf("linux binary not found at %s: %w", binPath, err)
	}

	// Create packages directory
	packagesDir := filepath.Join(cfg.BuildDir, "packages")
	if err := os.MkdirAll(packagesDir, 0o755); err != nil {
		return fmt.Errorf("failed to prepare packages directory: %w", err)
	}

	// Build .deb and .rpm packages
	var errs []string
	if err := packageDeb(cfg, binPath, packagesDir); err != nil {
		errs = append(errs, err.Error())
	}
	if err := packageRPM(cfg, binPath, packagesDir); err != nil {
		errs = append(errs, err.Error())
	}

	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}

	return nil
}
