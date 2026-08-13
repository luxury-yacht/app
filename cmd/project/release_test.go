package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewReleaseConfigUsesConfiguredVersionTag(t *testing.T) {
	cfg := newReleaseConfig(projectFacts{version: "v2.0.0"})

	require.Equal(t, "v2.0.0", cfg.version)
}

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

func TestFindReleaseAssetsRejectsDuplicateBasenames(t *testing.T) {
	artifactDir := t.TempDir()
	for _, platform := range []string{"linux-amd64", "linux-arm64"} {
		path := filepath.Join(artifactDir, platform, "luxury-yacht.deb")
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, []byte(platform), 0o600))
	}

	_, err := findReleaseAssets(releaseConfig{
		artifactsDir:  artifactDir,
		releaseAssets: []string{".deb"},
	})

	require.ErrorContains(t, err, `duplicate release asset name "luxury-yacht.deb"`)
}
