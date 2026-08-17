//go:build linux

package updatetemp

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

func TestPortableLinuxStagingCanRenameWhenSystemTempIsAnotherFilesystem(t *testing.T) {
	sharedMemoryInfo, err := os.Stat("/dev/shm")
	if err != nil || !sharedMemoryInfo.IsDir() {
		t.Skip("/dev/shm is unavailable")
	}
	systemTemp := t.TempDir()
	if filesystemDevice(t, systemTemp) == filesystemDevice(t, "/dev/shm") {
		t.Skip("system temp and /dev/shm are not separate filesystems")
	}

	dataHome, err := os.MkdirTemp("/dev/shm", "luxury-yacht-update-test-")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, os.RemoveAll(dataHome)) })
	installRoot := filepath.Join(dataHome, "luxury-yacht")
	require.NoError(t, os.Mkdir(installRoot, 0o755))
	target := filepath.Join(installRoot, "luxury-yacht")
	require.NoError(t, os.WriteFile(target, []byte("old"), 0o755))
	require.NoError(t, os.WriteFile(
		filepath.Join(installRoot, updateidentity.InstallationMarkerName),
		[]byte(`{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"portable","scope":"user"}`),
		0o644,
	))

	root, err := configureProcess(processConfig{
		Platform: "linux", Architecture: "arm64", SystemTempDir: systemTemp,
		ExecutablePath: target, UserID: "1000",
		Environment: &processTestEnvironment{values: make(map[string]string)},
	})
	require.NoError(t, err)
	require.Equal(t, filesystemDevice(t, target), filesystemDevice(t, root))

	staging := filepath.Join(root, "wails-update-cross-device")
	require.NoError(t, os.Mkdir(staging, 0o700))
	replacement := filepath.Join(staging, "luxury-yacht")
	require.NoError(t, os.WriteFile(replacement, []byte("new"), 0o755))
	require.NoError(t, os.Remove(target))
	require.NoError(t, os.Rename(replacement, target))
	require.Equal(t, []byte("new"), readFile(t, target))
}

func filesystemDevice(t *testing.T, path string) uint64 {
	t.Helper()
	info, err := os.Stat(path)
	require.NoError(t, err)
	stat, ok := info.Sys().(*syscall.Stat_t)
	require.True(t, ok)
	return uint64(stat.Dev)
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	contents, err := os.ReadFile(path)
	require.NoError(t, err)
	return contents
}
