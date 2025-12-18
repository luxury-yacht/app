package mage

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/magefile/mage/sh"
)

func BuildWindows(cfg BuildConfig) error {
	generateBuildManifest(cfg)

	// Update build args for Windows
	cfg.BuildArgs = append(cfg.BuildArgs, "-o", cfg.AppShortName+".exe")

	return sh.RunV("wails", cfg.BuildArgs...)
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
