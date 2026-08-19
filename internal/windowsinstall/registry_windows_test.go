//go:build windows

package windowsinstall

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows/registry"
)

func TestWindowsRegistrationOwnershipAndDisplayVersionReconciliation(t *testing.T) {
	root := t.TempDir()
	executablePath := filepath.Join(root, "luxury-yacht.exe")
	uninstallerPath := filepath.Join(root, "uninstall.exe")
	registryPath := `Software\LuxuryYachtTests-Registration-` + strconv.Itoa(os.Getpid())
	key, _, err := registry.CreateKey(registry.CURRENT_USER, registryPath, registry.ALL_ACCESS)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, registry.DeleteKey(registry.CURRENT_USER, registryPath))
	})
	require.NoError(t, key.SetStringValue("DisplayName", ProductName))
	require.NoError(t, key.SetStringValue("DisplayIcon", executablePath))
	require.NoError(t, key.SetStringValue("UninstallString", `"`+uninstallerPath+`"`))
	require.NoError(t, key.SetStringValue("DisplayVersion", "2.0.0-beta.3"))
	require.NoError(t, key.Close())

	require.True(t, registrationOwnsExecutable(registry.CURRENT_USER, registryPath, executablePath))
	require.NoError(t, setPerUserDisplayVersionAt(executablePath, "2.0.0-beta.4", registryPath))
	key, err = registry.OpenKey(registry.CURRENT_USER, registryPath, registry.QUERY_VALUE)
	require.NoError(t, err)
	displayVersion, _, err := key.GetStringValue("DisplayVersion")
	require.NoError(t, err)
	require.NoError(t, key.Close())
	require.Equal(t, "2.0.0-beta.4", displayVersion)

	key, err = registry.OpenKey(registry.CURRENT_USER, registryPath, registry.SET_VALUE)
	require.NoError(t, err)
	require.NoError(t, key.SetStringValue("UninstallString", `"`+filepath.Join(root, "other.exe")+`"`))
	require.NoError(t, key.Close())
	require.False(t, registrationOwnsExecutable(registry.CURRENT_USER, registryPath, executablePath))
	require.ErrorContains(t, setPerUserDisplayVersionAt(
		executablePath, "2.0.0-beta.5", registryPath,
	), "mismatched registration")
}
