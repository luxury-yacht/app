package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// CleanBuildOutputs removes generated build products while preserving the
// repository-owned Wails v3 Taskfiles, packaging definitions, and metadata.
func CleanBuildOutputs(cfg BuildConfig) error {
	paths := []string{
		"bin",
		cfg.ArtifactsDir,
		filepath.Join(cfg.BuildDir, "bin"),
		filepath.Join(cfg.BuildDir, "coverage"),
		filepath.Join(cfg.BuildDir, "linux", "appimage", "build"),
	}

	patterns := []string{
		filepath.Join(cfg.BuildDir, "linux", "*.desktop"),
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
		if err := os.RemoveAll(path); err != nil {
			cleanErrors = append(cleanErrors, fmt.Errorf("remove %q: %w", path, err))
		}
	}
	if err := resetBuildManifest(cfg.ManifestPath); err != nil {
		cleanErrors = append(cleanErrors, err)
	}
	return errors.Join(cleanErrors...)
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

// CleanFrontendOutputs removes generated frontend output and installed packages.
func CleanFrontendOutputs(cfg BuildConfig) error {
	paths := []string{
		filepath.Join(cfg.FrontendDir, "dist"),
		filepath.Join(cfg.FrontendDir, "coverage"),
		filepath.Join(cfg.FrontendDir, "node_modules"),
	}
	var cleanErrors []error
	for _, path := range paths {
		if err := os.RemoveAll(path); err != nil {
			cleanErrors = append(cleanErrors, fmt.Errorf("remove %q: %w", path, err))
		}
	}
	return errors.Join(cleanErrors...)
}

// CleanAllOutputs removes repository build and frontend output.
func CleanAllOutputs(cfg BuildConfig) error {
	return errors.Join(CleanBuildOutputs(cfg), CleanFrontendOutputs(cfg))
}
