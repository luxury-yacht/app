package updateconformance

import (
	"context"
	"crypto/sha512"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

type stagedLocalArtifact struct {
	directory string
	path      string
}

func (artifact stagedLocalArtifact) cleanup() {
	_ = os.RemoveAll(artifact.directory)
}

func stageLocalUpdaterArtifact(
	ctx context.Context,
	artifactPath, version, platform, architecture string,
) (stagedLocalArtifact, error) {
	label := map[string]string{"darwin": "macOS", "linux": "Linux"}[platform]
	if label == "" {
		label = platform
	}
	release, err := updateidentity.ParseReleaseVersion(version)
	if err != nil {
		return stagedLocalArtifact{}, fmt.Errorf("parse %s updater version: %w", label, err)
	}
	if release.Version != version {
		return stagedLocalArtifact{}, fmt.Errorf(
			"%s updater version %q is not canonical; use %q",
			label,
			version,
			release.Version,
		)
	}
	info, err := os.Lstat(artifactPath)
	if err != nil {
		return stagedLocalArtifact{}, fmt.Errorf("inspect %s updater artifact: %w", label, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return stagedLocalArtifact{}, fmt.Errorf(
			"%s updater artifact must be a regular non-symlink file: %s",
			label,
			artifactPath,
		)
	}
	file, err := os.Open(artifactPath)
	if err != nil {
		return stagedLocalArtifact{}, fmt.Errorf("open %s updater artifact: %w", label, err)
	}
	digest := sha512.New()
	_, digestErr := io.Copy(digest, file)
	closeErr := file.Close()
	if digestErr != nil {
		return stagedLocalArtifact{}, fmt.Errorf("digest %s updater artifact: %w", label, digestErr)
	}
	if closeErr != nil {
		return stagedLocalArtifact{}, fmt.Errorf("close %s updater artifact: %w", label, closeErr)
	}
	provider := localArtifactProvider{
		path: artifactPath,
		release: updater.Release{
			Version: release.Version,
			Channel: string(release.Channel),
			Artifact: updater.Artifact{
				Filename: filepath.Base(artifactPath), Platform: platform, Arch: architecture,
				Size: info.Size(),
			},
			Verification: &updater.Verification{DigestAlgo: "sha512", Digest: digest.Sum(nil)},
		},
	}
	client := updater.New(localUpdaterHost{})
	if err := client.Init(updater.Config{
		CurrentVersion: "0.0.0", Providers: []updater.Provider{provider},
		Platform: platform, Arch: architecture, Window: updater.WindowNone,
	}); err != nil {
		return stagedLocalArtifact{}, fmt.Errorf("configure Wails %s updater conformance check: %w", label, err)
	}
	if _, err := client.Check(ctx); err != nil {
		return stagedLocalArtifact{}, fmt.Errorf("check Wails %s updater artifact: %w", label, err)
	}
	if err := client.DownloadAndInstall(ctx); err != nil {
		return stagedLocalArtifact{}, fmt.Errorf("extract Wails %s updater artifact: %w", label, err)
	}
	downloaded := client.DownloadedPath()
	stagingDirectory := filepath.Dir(downloaded)
	staged := stagedLocalArtifact{directory: stagingDirectory, path: downloaded}
	if !strings.HasPrefix(filepath.Base(stagingDirectory), "wails-update-") {
		staged.cleanup()
		return stagedLocalArtifact{}, fmt.Errorf(
			"wails extracted %s payload outside an updater staging directory: %s",
			label,
			downloaded,
		)
	}
	entries, err := os.ReadDir(stagingDirectory)
	if err != nil {
		staged.cleanup()
		return stagedLocalArtifact{}, fmt.Errorf("read Wails %s staging directory: %w", label, err)
	}
	if len(entries) != 1 || entries[0].Name() != filepath.Base(downloaded) {
		staged.cleanup()
		return stagedLocalArtifact{}, fmt.Errorf("wails %s staging directory must contain exactly one payload", label)
	}
	return staged, nil
}
