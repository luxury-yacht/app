package mage

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
		filepath.Join(cfg.BuildDir, "coverage"),
		filepath.Join(cfg.BuildDir, "linux", "appimage", "build"),
		cfg.ManifestPath,
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
	return errors.Join(cleanErrors...)
}
