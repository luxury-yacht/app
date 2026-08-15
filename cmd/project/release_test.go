package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewReleaseConfigUsesConfiguredVersionTag(t *testing.T) {
	cfg := newReleaseConfig(projectFacts{version: "v2.0.0"})

	require.Equal(t, "v2.0.0", cfg.version)
}

func TestValidateReleaseTagRequiresExactConfiguredVersion(t *testing.T) {
	require.NoError(t, validateReleaseTag("v2.0.0-beta.1", "v2.0.0-beta.1"))
	require.EqualError(
		t,
		validateReleaseTag("v2.0.0-beta.1", ""),
		"release tag is required",
	)
	require.EqualError(
		t,
		validateReleaseTag("v2.0.0-beta.1", "v2.0.0"),
		`release tag "v2.0.0" does not exactly match configured version "v2.0.0-beta.1"`,
	)
}

func TestFindReleaseAssetsUsesConfiguredDirectory(t *testing.T) {
	artifactDir := filepath.Join(t.TempDir(), "downloaded")
	for _, name := range []string{"luxury-yacht.dmg", "luxury-yacht.exe", "updater.json", "notes.txt"} {
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
		filepath.Join(artifactDir, "platform", "updater.json"),
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

func TestCreateReleasePublishesOnlyAfterDraftAssetsAreUploaded(t *testing.T) {
	var calls [][]string
	runner := func(name string, args ...string) error {
		calls = append(calls, append([]string{name}, args...))
		return nil
	}
	cfg := releaseConfig{
		version:     "v2.0.0-beta.2",
		isBeta:      true,
		releaseRepo: "luxury-yacht/app",
	}

	err := createRelease(cfg, "/tmp/release-notes.md", []string{
		"artifacts/luxury-yacht-v2.0.0-beta.2-darwin-arm64.zip",
		"artifacts/updater.json",
	}, runner)

	require.NoError(t, err)
	require.Equal(t, [][]string{
		{
			"gh", "release", "create", "v2.0.0-beta.2",
			"--title", "v2.0.0-beta.2",
			"--notes-file", "/tmp/release-notes.md",
			"--repo", "luxury-yacht/app",
			"--draft", "--prerelease",
			"artifacts/luxury-yacht-v2.0.0-beta.2-darwin-arm64.zip",
			"artifacts/updater.json",
		},
		{"gh", "release", "edit", "v2.0.0-beta.2", "--draft=false", "--repo", "luxury-yacht/app"},
	}, calls)
}

func TestCreateReleaseLeavesDraftWhenPublishFails(t *testing.T) {
	publishFailure := errors.New("publish failed")
	call := 0
	runner := func(_ string, _ ...string) error {
		call++
		if call == 2 {
			return publishFailure
		}
		return nil
	}

	err := createRelease(releaseConfig{
		version:     "v2.0.0",
		releaseRepo: "luxury-yacht/app",
	}, "/tmp/release-notes.md", []string{"artifacts/updater.json"}, runner)

	require.ErrorIs(t, err, publishFailure)
	require.ErrorContains(t, err, "failed to publish draft release v2.0.0")
}

func TestValidateReleaseDoesNotAlreadyExistBlocksUnsafeRerun(t *testing.T) {
	require.NoError(t, validateReleaseDoesNotAlreadyExist(false, "v2.0.0"))
	require.EqualError(
		t,
		validateReleaseDoesNotAlreadyExist(true, "v2.0.0"),
		"release v2.0.0 already exists; inspect it and remove any failed draft before retrying",
	)
}

func TestSelectUpdaterArtifactRequiresOneExplicitRegularFile(t *testing.T) {
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-darwin-arm64.zip")
	require.NoError(t, os.WriteFile(artifact, []byte("artifact"), 0o600))

	selected, err := selectUpdaterArtifact([]string{artifact})

	require.NoError(t, err)
	require.Equal(t, artifact, selected)
}

func TestSelectUpdaterArtifactRejectsAmbiguousOrUnsafeInputs(t *testing.T) {
	directory := t.TempDir()
	artifact := filepath.Join(directory, "luxury-yacht-v2.0.0-darwin-arm64.zip")
	require.NoError(t, os.WriteFile(artifact, []byte("artifact"), 0o600))
	second := filepath.Join(directory, "luxury-yacht-v2.0.0-darwin-amd64.zip")
	require.NoError(t, os.WriteFile(second, []byte("artifact"), 0o600))

	for _, test := range []struct {
		name   string
		inputs []string
		want   string
	}{
		{name: "none", want: "exactly one updater artifact"},
		{name: "multiple", inputs: []string{artifact, second}, want: "exactly one updater artifact"},
		{name: "glob", inputs: []string{filepath.Join(directory, "*.zip")}, want: "must not contain glob syntax"},
		{name: "directory", inputs: []string{directory}, want: "must be a regular file"},
		{name: "missing", inputs: []string{filepath.Join(directory, "missing.zip")}, want: "stat updater artifact"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := selectUpdaterArtifact(test.inputs)

			require.ErrorContains(t, err, test.want)
		})
	}
}
