package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// CheckWailsBindings regenerates the pinned Wails v3 TypeScript model in an
// isolated directory and fails when the committed bindings have drifted.
func CheckWailsBindings(cfg BuildConfig) error {
	generatedDir, err := os.MkdirTemp("", "luxury-yacht-wails-bindings-")
	if err != nil {
		return fmt.Errorf("create temporary bindings directory: %w", err)
	}
	defer os.RemoveAll(generatedDir)

	if err := RunCommand(
		"wails3",
		"generate", "bindings",
		"-ts",
		"-i",
		"-d", generatedDir,
		"-clean",
		"-time-type", "string",
		"-names",
		"./...",
	); err != nil {
		return fmt.Errorf("generate Wails bindings: %w", err)
	}

	committedDir := filepath.Join(cfg.FrontendDir, "bindings")
	if err := CompareDirectoryTrees(committedDir, generatedDir); err != nil {
		return fmt.Errorf("wails bindings are stale; run `wails3 generate bindings -ts -i -d frontend/bindings -clean -time-type string -names ./...`: %w", err)
	}
	return nil
}

// CompareDirectoryTrees compares file names and contents while ignoring
// directory metadata, which is not part of the generated binding contract.
func CompareDirectoryTrees(expectedRoot, actualRoot string) error {
	expected, err := directoryFiles(expectedRoot)
	if err != nil {
		return fmt.Errorf("read expected directory: %w", err)
	}
	actual, err := directoryFiles(actualRoot)
	if err != nil {
		return fmt.Errorf("read actual directory: %w", err)
	}

	expectedPaths := sortedPaths(expected)
	for _, path := range expectedPaths {
		actualPath, ok := actual[path]
		if !ok {
			return fmt.Errorf("missing generated file: %s", path)
		}
		expectedContents, err := os.ReadFile(expected[path])
		if err != nil {
			return fmt.Errorf("read expected file %q: %w", path, err)
		}
		actualContents, err := os.ReadFile(actualPath)
		if err != nil {
			return fmt.Errorf("read actual file %q: %w", path, err)
		}
		if !bytes.Equal(expectedContents, actualContents) {
			return fmt.Errorf("content differs: %s", path)
		}
	}
	for _, path := range sortedPaths(actual) {
		if _, ok := expected[path]; !ok {
			return fmt.Errorf("unexpected generated file: %s", path)
		}
	}
	return nil
}

func directoryFiles(root string) (map[string]string, error) {
	files := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported non-regular file %q", path)
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(relativePath)] = path
		return nil
	})
	return files, err
}

func sortedPaths(files map[string]string) []string {
	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}
