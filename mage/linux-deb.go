package mage

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/magefile/mage/sh"
)

type debTemplateData struct {
	AppShortName string
	AppLongName  string
	Version      string
	DebVersion   string
	DebArch      string
}

func renderDebTemplate(templatePath, destPath string, data debTemplateData, perm os.FileMode) error {
	tmpl, err := template.ParseFiles(templatePath)
	if err != nil {
		return fmt.Errorf("failed to parse template %s: %w", templatePath, err)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("failed to create %s: %w", destPath, err)
	}
	defer f.Close()

	if err := tmpl.Execute(f, data); err != nil {
		return fmt.Errorf("failed to render %s: %w", destPath, err)
	}

	if perm != 0 {
		if err := os.Chmod(destPath, perm); err != nil {
			return fmt.Errorf("failed to set permissions on %s: %w", destPath, err)
		}
	}

	return nil
}

func packageDeb(cfg BuildConfig, binPath, packagesDir string) error {
	if _, err := exec.LookPath("dpkg-deb"); err != nil {
		return fmt.Errorf("dpkg-deb not found; install dpkg-dev to build .deb packages")
	}

	linuxOutputDir := filepath.Join(cfg.BuildDir, "artifacts")
	if err := os.MkdirAll(linuxOutputDir, 0o755); err != nil {
		return fmt.Errorf("failed to create linux package output dir: %w", err)
	}

	fmt.Println("\n📦 Building .deb package")

	debArch := map[string]string{
		"amd64": "amd64",
		"arm64": "arm64",
	}[cfg.ArchType]
	if debArch == "" {
		debArch = cfg.ArchType
	}

	stageRoot := filepath.Join(packagesDir, "deb", fmt.Sprintf("%s_%s_%s", cfg.AppShortName, cfg.Version, debArch))
	binDestDir := filepath.Join(stageRoot, "usr", "local", "bin")
	if err := os.MkdirAll(binDestDir, 0o755); err != nil {
		return fmt.Errorf("failed to create deb staging dir: %w", err)
	}
	binDest := filepath.Join(binDestDir, cfg.AppShortName)
	if err := sh.Copy(binDest, binPath); err != nil {
		return fmt.Errorf("failed to copy binary into deb staging dir: %w", err)
	}
	if err := os.Chmod(binDest, 0o755); err != nil {
		return fmt.Errorf("failed to set executable bit on staged binary: %w", err)
	}

	controlDir := filepath.Join(stageRoot, "DEBIAN")
	if err := os.MkdirAll(controlDir, 0o755); err != nil {
		return fmt.Errorf("failed to create DEBIAN directory: %w", err)
	}

	// Strip the leading 'v' from the version because dpkg-deb doesn't like it.
	fixedVersion := strings.TrimPrefix(cfg.Version, "v")
	tmplData := debTemplateData{
		AppShortName: cfg.AppShortName,
		AppLongName:  cfg.AppLongName,
		Version:      cfg.Version,
		DebVersion:   fixedVersion,
		DebArch:      debArch,
	}

	controlPath := filepath.Join(controlDir, "control")
	controlTemplate := filepath.Join("mage", "deb", "control.tmpl")
	if err := renderDebTemplate(controlTemplate, controlPath, tmplData, 0o644); err != nil {
		return err
	}

	if err := installDesktopAssets(cfg, stageRoot); err != nil {
		return fmt.Errorf("failed to stage desktop assets: %w", err)
	}

	outputPath := filepath.Join(linuxOutputDir, fmt.Sprintf("%s_%s_linux_%s.deb", cfg.AppShortName, cfg.Version, debArch))
	if err := sh.RunV("dpkg-deb", "--build", stageRoot, outputPath); err != nil {
		return fmt.Errorf("failed to build .deb: %w", err)
	}

	if err := os.RemoveAll(filepath.Join(packagesDir, "deb")); err != nil {
		return fmt.Errorf("failed to clean deb staging dir: %w", err)
	}

	fmt.Printf("✅ Built Debian package: %s\n", outputPath)
	return nil
}
