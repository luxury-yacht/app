// Package updateconformance validates published artifacts through Wails' public
// updater entry points.
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

// ValidateMacOSArchive extracts a macOS update through Wails and passes the
// exact staged app bundle to validateBundle. The staging directory is removed
// before this function returns.
func ValidateMacOSArchive(
	ctx context.Context,
	artifactPath, version, architecture string,
	validateBundle func(string) error,
) error {
	release, err := updateidentity.ParseReleaseVersion(version)
	if err != nil {
		return fmt.Errorf("parse macOS updater version: %w", err)
	}
	if release.Version != version {
		return fmt.Errorf("macOS updater version %q is not canonical; use %q", version, release.Version)
	}
	if architecture != "amd64" && architecture != "arm64" {
		return fmt.Errorf("unsupported macOS updater architecture %q", architecture)
	}
	info, err := os.Lstat(artifactPath)
	if err != nil {
		return fmt.Errorf("inspect macOS updater artifact: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("macOS updater artifact must be a regular non-symlink file: %s", artifactPath)
	}
	file, err := os.Open(artifactPath)
	if err != nil {
		return fmt.Errorf("open macOS updater artifact: %w", err)
	}
	digest := sha512.New()
	_, digestErr := io.Copy(digest, file)
	closeErr := file.Close()
	if digestErr != nil {
		return fmt.Errorf("digest macOS updater artifact: %w", digestErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close macOS updater artifact: %w", closeErr)
	}
	provider := localArtifactProvider{
		path: artifactPath,
		release: updater.Release{
			Version: release.Version,
			Channel: string(release.Channel),
			Artifact: updater.Artifact{
				Filename: filepath.Base(artifactPath), Platform: "darwin", Arch: architecture,
				Size: info.Size(),
			},
			Verification: &updater.Verification{DigestAlgo: "sha512", Digest: digest.Sum(nil)},
		},
	}
	client := updater.New(localUpdaterHost{})
	if err := client.Init(updater.Config{
		CurrentVersion: "0.0.0", Providers: []updater.Provider{provider},
		Platform: "darwin", Arch: architecture, Window: updater.WindowNone,
	}); err != nil {
		return fmt.Errorf("configure Wails macOS updater conformance check: %w", err)
	}
	if _, err := client.Check(ctx); err != nil {
		return fmt.Errorf("check Wails macOS updater artifact: %w", err)
	}
	if err := client.DownloadAndInstall(ctx); err != nil {
		return fmt.Errorf("extract Wails macOS updater artifact: %w", err)
	}
	downloaded := client.DownloadedPath()
	stagingDirectory := filepath.Dir(downloaded)
	defer os.RemoveAll(stagingDirectory)
	if !strings.HasPrefix(filepath.Base(stagingDirectory), "wails-update-") {
		return fmt.Errorf("wails extracted macOS payload outside an updater staging directory: %s", downloaded)
	}
	payloadInfo, err := os.Lstat(downloaded)
	if err != nil {
		return fmt.Errorf("inspect Wails-extracted macOS payload: %w", err)
	}
	if payloadInfo.Mode()&os.ModeSymlink != 0 || !payloadInfo.IsDir() ||
		!strings.HasSuffix(filepath.Base(downloaded), ".app") {
		return fmt.Errorf("wails-extracted macOS payload must be one non-symlink .app bundle: %s", downloaded)
	}
	entries, err := os.ReadDir(stagingDirectory)
	if err != nil {
		return fmt.Errorf("read Wails macOS staging directory: %w", err)
	}
	if len(entries) != 1 || entries[0].Name() != filepath.Base(downloaded) {
		return fmt.Errorf("wails macOS staging directory must contain exactly one .app payload")
	}
	if validateBundle == nil {
		return fmt.Errorf("macOS updater bundle validator is required")
	}
	if err := validateBundle(downloaded); err != nil {
		return fmt.Errorf("validate Wails-extracted macOS bundle: %w", err)
	}
	return nil
}

type localUpdaterHost struct{}

func (localUpdaterHost) Emit(string, ...any) bool { return false }
func (localUpdaterHost) OnEvent(string, func(any)) func() {
	return func() {
		// Local conformance registers no host listeners, so there is nothing to remove.
	}
}
func (localUpdaterHost) OpenWindow(updater.WindowOptions) updater.WindowHandle {
	return localUpdaterWindow{}
}
func (localUpdaterHost) Quit() {
	// Local conformance never launches an application process that needs to quit.
}

type localUpdaterWindow struct{}

func (localUpdaterWindow) EmitEvent(string, ...any) bool { return false }
func (localUpdaterWindow) Show() {
	// Windowless conformance has no updater window to show.
}
func (localUpdaterWindow) Close() {
	// Windowless conformance has no updater window to close.
}

type localArtifactProvider struct {
	path    string
	release updater.Release
}

func (localArtifactProvider) Name() string { return "local-conformance" }

func (provider localArtifactProvider) Check(context.Context, updater.CheckRequest) (*updater.Release, error) {
	copy := provider.release
	return &copy, nil
}

func (provider localArtifactProvider) Download(
	ctx context.Context,
	_ *updater.Release,
	destination io.Writer,
	onProgress func(int64, int64),
) error {
	file, err := os.Open(provider.path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	buffer := make([]byte, 32*1024)
	var written int64
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		read, readErr := file.Read(buffer)
		if read > 0 {
			count, writeErr := destination.Write(buffer[:read])
			written += int64(count)
			onProgress(written, info.Size())
			if writeErr != nil {
				return writeErr
			}
			if count != read {
				return io.ErrShortWrite
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return nil
			}
			return readErr
		}
	}
}
