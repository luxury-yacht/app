package mage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCleanBuildOutputsPreservesWailsSources(t *testing.T) {
	root := t.TempDir()
	buildDir := filepath.Join(root, "build")
	configPath := filepath.Join(buildDir, "config.yml")
	artifactPath := filepath.Join(buildDir, "bin", "luxury-yacht")
	manifestPath := filepath.Join(root, "backend", "buildinfo", "generated.json")

	for path, contents := range map[string]string{
		configPath:   "info:\n  productName: Luxury Yacht\n",
		artifactPath: "binary",
		manifestPath: "{}",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	cfg := BuildConfig{
		BuildDir:     buildDir,
		ArtifactsDir: filepath.Join(buildDir, "artifacts"),
		ManifestPath: manifestPath,
	}
	if err := CleanBuildOutputs(cfg); err != nil {
		t.Fatalf("CleanBuildOutputs() error = %v", err)
	}

	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("Wails source config was removed: %v", err)
	}
	if _, err := os.Stat(artifactPath); !os.IsNotExist(err) {
		t.Fatalf("build artifact still exists; stat error = %v", err)
	}
	if _, err := os.Stat(manifestPath); !os.IsNotExist(err) {
		t.Fatalf("generated manifest still exists; stat error = %v", err)
	}
}
