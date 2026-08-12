package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindReleaseAssetsUsesConfiguredDirectory(t *testing.T) {
	artifactDir := filepath.Join(t.TempDir(), "downloaded")
	for _, name := range []string{"luxury-yacht.dmg", "luxury-yacht.exe", "notes.txt"} {
		path := filepath.Join(artifactDir, "platform", name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("artifact"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	assets, err := findReleaseAssets(releaseConfig{
		artifactsDir:  artifactDir,
		releaseAssets: []string{".dmg", ".exe"},
	})
	if err != nil {
		t.Fatalf("findReleaseAssets() error = %v", err)
	}
	want := []string{
		filepath.Join(artifactDir, "platform", "luxury-yacht.dmg"),
		filepath.Join(artifactDir, "platform", "luxury-yacht.exe"),
	}
	if len(assets) != len(want) {
		t.Fatalf("findReleaseAssets() = %v, want %v", assets, want)
	}
	for index := range want {
		if assets[index] != want[index] {
			t.Errorf("findReleaseAssets()[%d] = %q, want %q", index, assets[index], want[index])
		}
	}
}
