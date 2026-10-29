package updateconformance

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/updatestate"
	"github.com/stretchr/testify/require"
)

// The update state store must own whatever directory the real Wails updater
// stages into for the target the installation probe resolves. A Wails upgrade
// that moved staging out of the temp root broke this silently.
func TestUpdateStateOwnsTheDirectoryWailsStagesIn(t *testing.T) {
	executable, err := os.Executable()
	require.NoError(t, err)
	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.Platform(runtime.GOOS), Architecture: "arm64",
		ExecutablePath: executable,
	})
	require.NoError(t, err)
	base := t.TempDir()
	root := filepath.Join(base, "owned-temp")
	require.NoError(t, os.Mkdir(root, 0o700))
	store, err := updatestate.New(updatestate.Config{
		StatePath:  filepath.Join(base, "config", "application-update.json"),
		TempRoot:   root,
		TargetPath: probe.TargetPath,
	})
	require.NoError(t, err)
	artifact := filepath.Join(t.TempDir(), "luxury-yacht-v2.0.0-darwin-arm64.zip")
	writeArchive(t, artifact, false)

	err = ValidateMacOSArchive(context.Background(), artifact, "2.0.0", "arm64", func(payload string) error {
		staging, resolveErr := store.ResolveStagingDirectory(payload)
		require.NoError(t, resolveErr)
		require.Equal(t, filepath.Dir(payload), staging)
		return store.RecordPrepared(updatestate.PreparedUpdate{
			TargetVersion: "2.0.0", StagingDir: staging,
			RecoveryTarget: updateidentity.RecoveryMacDownload,
		})
	})

	require.NoError(t, err)
}
