package updateconformance

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ValidateLinuxArchive stages a Linux update through Wails and proves that
// the extracted replacement is exactly one executable regular file.
func ValidateLinuxArchive(
	ctx context.Context,
	artifactPath, version, architecture, binaryName string,
) error {
	if architecture != "amd64" && architecture != "arm64" {
		return fmt.Errorf("unsupported Linux updater architecture %q", architecture)
	}
	binaryName = strings.TrimSpace(binaryName)
	if binaryName == "" || binaryName == "." || binaryName == ".." ||
		filepath.Base(binaryName) != binaryName || strings.ContainsAny(binaryName, `/\`) {
		return fmt.Errorf("unsafe Linux updater binary name %q", binaryName)
	}
	staged, err := stageLocalUpdaterArtifact(ctx, artifactPath, version, "linux", architecture)
	if err != nil {
		return err
	}
	defer staged.cleanup()
	payloadInfo, err := os.Lstat(staged.path)
	if err != nil {
		return fmt.Errorf("inspect Wails-extracted Linux payload: %w", err)
	}
	if payloadInfo.Mode()&os.ModeSymlink != 0 || !payloadInfo.Mode().IsRegular() ||
		payloadInfo.Mode().Perm()&0o111 == 0 || filepath.Base(staged.path) != binaryName {
		return fmt.Errorf(
			"wails-extracted Linux payload must be one executable regular file named %s: %s",
			binaryName,
			staged.path,
		)
	}
	return nil
}
