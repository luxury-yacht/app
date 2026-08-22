//go:build windows

package updatetemp

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows"
)

func TestWindowsCreatesPrivateDirectoryOwnedByProcessUser(t *testing.T) {
	root := filepath.Join(t.TempDir(), "private")
	require.NoError(t, createOwnedDirectory(root))

	info, err := os.Lstat(root)
	require.NoError(t, err)
	require.NoError(t, validateOwnedPath(root, info, true))

	descriptor, err := windows.GetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION,
	)
	require.NoError(t, err)
	owner, _, err := descriptor.Owner()
	require.NoError(t, err)
	currentUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	require.NoError(t, err)
	require.True(t, owner.Equals(currentUser.User.Sid))
}

func TestWindowsCreatesPrivateFileOwnedByProcessUser(t *testing.T) {
	path := filepath.Join(t.TempDir(), "private-file")
	file, err := createOwnedFile(path)
	require.NoError(t, err)
	require.NoError(t, file.Close())

	info, err := os.Lstat(path)
	require.NoError(t, err)
	require.NoError(t, validateOwnedPath(path, info, false))

	descriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION,
	)
	require.NoError(t, err)
	owner, _, err := descriptor.Owner()
	require.NoError(t, err)
	currentUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	require.NoError(t, err)
	require.True(t, owner.Equals(currentUser.User.Sid))
}

func TestWindowsValidationDoesNotRequireAnExactDACL(t *testing.T) {
	root := filepath.Join(t.TempDir(), "unprotected")
	require.NoError(t, createOwnedDirectory(root))

	descriptor, err := windows.GetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	require.NoError(t, err)
	dacl, _, err := descriptor.DACL()
	require.NoError(t, err)
	require.NoError(t, windows.SetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.UNPROTECTED_DACL_SECURITY_INFORMATION,
		nil,
		nil,
		dacl,
		nil,
	))
	runtime.KeepAlive(descriptor)

	updated, err := windows.GetNamedSecurityInfo(
		root,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	require.NoError(t, err)
	control, _, err := updated.Control()
	require.NoError(t, err)
	require.Zero(t, control&windows.SE_DACL_PROTECTED)

	info, err := os.Lstat(root)
	require.NoError(t, err)
	require.NoError(t, validateOwnedPath(root, info, true))
}
