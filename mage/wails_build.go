package mage

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/magefile/mage/sh"
)

func wailsTaskArgs(action, goos, arch string, extra ...string) []string {
	args := []string{action, "GOOS=" + goos, "ARCH=" + arch}
	return append(args, extra...)
}

// PrepareWailsBuild synchronizes the repository-owned inputs consumed by the
// Wails v3 Taskfiles before a build or dev session starts.
func PrepareWailsBuild(cfg BuildConfig) error {
	iconDestination := filepath.Join(cfg.BuildDir, "appicon.png")
	if err := sh.Copy(iconDestination, cfg.IconSource); err != nil {
		return fmt.Errorf("stage application icon: %w", err)
	}
	if err := generateBuildManifest(cfg); err != nil {
		return fmt.Errorf("generate build manifest: %w", err)
	}
	return nil
}

func runWailsTask(cfg BuildConfig, action string, extra ...string) error {
	if err := PrepareWailsBuild(cfg); err != nil {
		return err
	}
	args := wailsTaskArgs(action, cfg.OsType, cfg.ArchType, extra...)
	fmt.Printf("\n🛠️ Wails v3 args: %v\n\n", args)
	return sh.RunV("wails3", args...)
}

// CheckWailsBindings regenerates the pinned Wails v3 TypeScript model in an
// isolated directory and fails when the committed bindings have drifted.
func CheckWailsBindings(cfg BuildConfig) error {
	generatedDir, err := os.MkdirTemp("", "luxury-yacht-wails-bindings-")
	if err != nil {
		return fmt.Errorf("create temporary bindings directory: %w", err)
	}
	defer os.RemoveAll(generatedDir)

	if err := sh.RunV(
		"wails3",
		"generate", "bindings",
		"-ts",
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
		return fmt.Errorf("wails bindings are stale; run `wails3 generate bindings -ts -d frontend/bindings -clean -time-type string -names ./...`: %w", err)
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

// UpdateWailsBuildAssets refreshes Wails-owned platform metadata and then
// enforces this repository's desktop-only platform contract.
func UpdateWailsBuildAssets(cfg BuildConfig) error {
	configPath := filepath.Join(cfg.BuildDir, "config.yml")
	if err := sh.RunV(
		"wails3",
		"update", "build-assets",
		"-name", cfg.AppShortName,
		"-binaryname", cfg.AppShortName,
		"-config", configPath,
		"-dir", cfg.BuildDir,
	); err != nil {
		return fmt.Errorf("update Wails build assets: %w", err)
	}
	return NormalizeWailsBuildAssets(cfg.BuildDir)
}

// NormalizeWailsBuildAssets removes platforms this desktop application does
// not support. The Wails beta asset updater currently emits iOS metadata even
// when the repository has no mobile build tasks.
func NormalizeWailsBuildAssets(buildDir string) error {
	for _, path := range []string{
		filepath.Join(buildDir, "ios"),
		filepath.Join(buildDir, "windows", "msix"),
	} {
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("remove unsupported Wails build assets %q: %w", path, err)
		}
	}

	wailsToolsPath := filepath.Join(buildDir, "windows", "nsis", "wails_tools.nsh")
	contents, err := os.ReadFile(wailsToolsPath)
	if err != nil {
		return fmt.Errorf("read generated NSIS tools: %w", err)
	}
	const generatedHeader = "# DO NOT EDIT - Generated automatically by `wails build`"
	const v3Header = "# DO NOT EDIT - Generated automatically by Wails v3 build assets"
	updated := strings.Replace(string(contents), generatedHeader, v3Header, 1)
	if !strings.HasPrefix(updated, v3Header) {
		return fmt.Errorf("generated NSIS tools header is not recognised")
	}
	if updated == string(contents) {
		// Continue: the Linux package metadata also needs repository-specific
		// normalization after every upstream refresh.
	} else {
		info, err := os.Stat(wailsToolsPath)
		if err != nil {
			return fmt.Errorf("stat generated NSIS tools: %w", err)
		}
		if err := os.WriteFile(wailsToolsPath, []byte(updated), info.Mode().Perm()); err != nil {
			return fmt.Errorf("write generated NSIS tools: %w", err)
		}
	}

	nfpmPath := filepath.Join(buildDir, "linux", "nfpm", "nfpm.yaml")
	nfpmContents, err := os.ReadFile(nfpmPath)
	if err != nil {
		return fmt.Errorf("read generated nFPM config: %w", err)
	}
	nfpmUpdated := strings.Replace(string(nfpmContents), `  - src: "./bin/`, `  - src: "./build/bin/`, 1)
	const legacyGTKStart = "# If you build your app with -tags gtk3"
	if start := strings.Index(nfpmUpdated, legacyGTKStart); start >= 0 {
		const nextSection = "# replaces:"
		endOffset := strings.Index(nfpmUpdated[start:], nextSection)
		if endOffset < 0 {
			return fmt.Errorf("generated nFPM GTK3 guidance has no terminating section")
		}
		nfpmUpdated = nfpmUpdated[:start] + nfpmUpdated[start+endOffset:]
	}
	if strings.Contains(nfpmUpdated, `src: "./bin/`) {
		return fmt.Errorf("generated nFPM binary source is not repository-rooted")
	}
	if strings.Contains(nfpmUpdated, "gtk3") || strings.Contains(nfpmUpdated, "libgtk-3") {
		return fmt.Errorf("generated nFPM config still contains GTK3 guidance")
	}
	if nfpmUpdated != string(nfpmContents) {
		info, err := os.Stat(nfpmPath)
		if err != nil {
			return fmt.Errorf("stat generated nFPM config: %w", err)
		}
		if err := os.WriteFile(nfpmPath, []byte(nfpmUpdated), info.Mode().Perm()); err != nil {
			return fmt.Errorf("write generated nFPM config: %w", err)
		}
	}

	// Beta.7 generates a Debian 12 (bookworm) image even though its GTK4 backend
	// requires libwebkitgtk-6.0-dev, which enters the supported Debian floor in
	// Debian 13 (trixie). Keep regenerated cross-build assets on that same floor.
	crossDockerfilePath := filepath.Join(buildDir, "docker", "Dockerfile.cross")
	crossDockerfile, err := os.ReadFile(crossDockerfilePath)
	if err != nil {
		return fmt.Errorf("read generated cross-build Dockerfile: %w", err)
	}
	dockerfileLines := strings.Split(string(crossDockerfile), "\n")
	baseLine := -1
	for index, line := range dockerfileLines {
		if strings.HasPrefix(line, "FROM golang:") {
			baseLine = index
			break
		}
	}
	if baseLine < 0 {
		return fmt.Errorf("generated cross-build Dockerfile has an unrecognised base image")
	}
	switch {
	case strings.HasSuffix(dockerfileLines[baseLine], "-bookworm"):
		dockerfileLines[baseLine] = strings.TrimSuffix(dockerfileLines[baseLine], "-bookworm") + "-trixie"
	case strings.HasSuffix(dockerfileLines[baseLine], "-trixie"):
		return nil
	default:
		return fmt.Errorf("generated cross-build Dockerfile base must pin Debian trixie, got %q", dockerfileLines[baseLine])
	}
	info, err := os.Stat(crossDockerfilePath)
	if err != nil {
		return fmt.Errorf("stat generated cross-build Dockerfile: %w", err)
	}
	if err := os.WriteFile(crossDockerfilePath, []byte(strings.Join(dockerfileLines, "\n")), info.Mode().Perm()); err != nil {
		return fmt.Errorf("write generated cross-build Dockerfile: %w", err)
	}
	return nil
}
