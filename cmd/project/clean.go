package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// wailsMacOSOutputMarker is the file `wails3 tool prepare-macos-output` keeps in
// each output directory it has checked or relocated.
const wailsMacOSOutputMarker = ".wails-provider-checked"

type cleanConfig struct {
	artifactsDir string
	buildDir     string
	frontendDir  string
	manifestPath string
}

func defaultCleanConfig() cleanConfig {
	return cleanConfig{
		artifactsDir: projectArtifactsDir,
		buildDir:     projectBuildDir,
		frontendDir:  projectFrontendDir,
		manifestPath: projectManifestPath,
	}
}

// cleanBuildOutputs removes generated build products while preserving the
// repository-owned Wails v3 Taskfiles, packaging definitions, and metadata.
func cleanBuildOutputs(cfg cleanConfig) error {
	paths := []string{
		"bin",
		cfg.artifactsDir,
		filepath.Join(cfg.buildDir, "bin"),
		filepath.Join(cfg.buildDir, "coverage"),
		filepath.Join(cfg.buildDir, "linux", "appimage", "build"),
	}

	patterns := []string{
		filepath.Join(cfg.buildDir, "linux", "*.desktop"),
		"wails_windows_*.syso",
	}
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			return fmt.Errorf("resolve generated build outputs %q: %w", pattern, err)
		}
		paths = append(paths, matches...)
	}

	var cleanErrors []error
	for _, path := range paths {
		if path == "" {
			continue
		}
		if err := removeBuildOutput(path); err != nil {
			cleanErrors = append(cleanErrors, fmt.Errorf("remove %q: %w", path, err))
		}
	}
	if err := resetBuildManifest(cfg.manifestPath); err != nil {
		cleanErrors = append(cleanErrors, err)
	}
	return errors.Join(cleanErrors...)
}

// removeBuildOutput deletes a generated path. A link to relocated macOS output
// takes that directory with it, because `wails3 tool prepare-macos-output`
// refuses to relocate over an existing target and the next build would fail.
// Any other link loses only the link.
func removeBuildOutput(path string) error {
	if target, relocated := relocatedMacOSOutput(path); relocated {
		if err := os.RemoveAll(target); err != nil {
			return err
		}
	}
	return os.RemoveAll(path)
}

func relocatedMacOSOutput(path string) (string, bool) {
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		return "", false
	}
	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", false
	}
	if _, err := os.Stat(filepath.Join(target, wailsMacOSOutputMarker)); err != nil {
		return "", false
	}
	return target, true
}

func resetBuildManifest(path string) error {
	if path == "" {
		return nil
	}
	defaultPath := filepath.Join(filepath.Dir(path), "default.json")
	contents, err := os.ReadFile(defaultPath)
	if err != nil {
		return fmt.Errorf("read default build manifest %q: %w", defaultPath, err)
	}
	if err := os.WriteFile(path, contents, 0o644); err != nil {
		return fmt.Errorf("reset build manifest %q: %w", path, err)
	}
	return nil
}

// cleanFrontendOutputs removes generated frontend output and installed packages.
func cleanFrontendOutputs(cfg cleanConfig) error {
	paths := []string{
		filepath.Join(cfg.frontendDir, "dist"),
		filepath.Join(cfg.frontendDir, "coverage"),
		filepath.Join(cfg.frontendDir, "node_modules"),
	}
	var cleanErrors []error
	for _, path := range paths {
		if err := os.RemoveAll(path); err != nil {
			cleanErrors = append(cleanErrors, fmt.Errorf("remove %q: %w", path, err))
		}
	}
	return errors.Join(cleanErrors...)
}

// cleanAllOutputs removes repository build and frontend output.
func cleanAllOutputs(cfg cleanConfig) error {
	return errors.Join(cleanBuildOutputs(cfg), cleanFrontendOutputs(cfg))
}
