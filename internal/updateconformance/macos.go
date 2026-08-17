// Package updateconformance validates published artifacts through Wails' public
// updater entry points.
package updateconformance

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

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
	if architecture != "amd64" && architecture != "arm64" {
		return fmt.Errorf("unsupported macOS updater architecture %q", architecture)
	}
	staged, err := stageLocalUpdaterArtifact(ctx, artifactPath, version, "darwin", architecture)
	if err != nil {
		return err
	}
	defer staged.cleanup()
	payloadInfo, err := os.Lstat(staged.path)
	if err != nil {
		return fmt.Errorf("inspect Wails-extracted macOS payload: %w", err)
	}
	if payloadInfo.Mode()&os.ModeSymlink != 0 || !payloadInfo.IsDir() ||
		!strings.HasSuffix(filepath.Base(staged.path), ".app") {
		return fmt.Errorf("wails-extracted macOS payload must be one non-symlink .app bundle: %s", staged.path)
	}
	if validateBundle == nil {
		return fmt.Errorf("macOS updater bundle validator is required")
	}
	if err := validateBundle(staged.path); err != nil {
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
