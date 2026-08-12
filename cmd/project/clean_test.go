package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCleanBuildOutputsPreservesWailsSources(t *testing.T) {
	root := t.TempDir()
	buildDir := filepath.Join(root, "build")
	configPath := filepath.Join(buildDir, "config.yml")
	artifactPath := filepath.Join(root, "bin", "luxury-yacht")
	manifestPath := filepath.Join(root, "backend", "buildinfo", "generated.json")
	defaultManifestPath := filepath.Join(root, "backend", "buildinfo", "default.json")
	releaseArtifactPath := filepath.Join(root, "artifacts", "luxury-yacht.dmg")

	for path, contents := range map[string]string{
		configPath:          "info:\n  productName: Luxury Yacht\n",
		artifactPath:        "binary",
		manifestPath:        "{}",
		defaultManifestPath: `{"version":"dev"}`,
		releaseArtifactPath: "package",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	cfg := cleanConfig{
		buildDir:     buildDir,
		artifactsDir: filepath.Join(root, "artifacts"),
		manifestPath: manifestPath,
	}
	originalWorkingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(originalWorkingDirectory) })
	if err := cleanBuildOutputs(cfg); err != nil {
		t.Fatalf("CleanBuildOutputs() error = %v", err)
	}

	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("Wails source config was removed: %v", err)
	}
	if _, err := os.Stat(artifactPath); !os.IsNotExist(err) {
		t.Fatalf("build artifact still exists; stat error = %v", err)
	}
	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read reset build manifest: %v", err)
	}
	if string(manifest) != `{"version":"dev"}` {
		t.Fatalf("reset build manifest = %q", manifest)
	}
	if _, err := os.Stat(releaseArtifactPath); !os.IsNotExist(err) {
		t.Fatalf("release artifact still exists; stat error = %v", err)
	}
}

func TestCleanFrontendOutputsRemovesGeneratedState(t *testing.T) {
	root := t.TempDir()
	frontendDir := filepath.Join(root, "frontend")
	for _, path := range []string{
		filepath.Join(frontendDir, "dist", "index.html"),
		filepath.Join(frontendDir, "coverage", "index.html"),
		filepath.Join(frontendDir, "node_modules", "package", "index.js"),
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("generated"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	if err := cleanFrontendOutputs(cleanConfig{frontendDir: frontendDir}); err != nil {
		t.Fatalf("CleanFrontendOutputs() error = %v", err)
	}
	for _, path := range []string{"dist", "coverage", "node_modules"} {
		if _, err := os.Stat(filepath.Join(frontendDir, path)); !os.IsNotExist(err) {
			t.Fatalf("frontend output %s still exists; stat error = %v", path, err)
		}
	}
}
