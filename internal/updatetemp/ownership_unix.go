//go:build !windows

package updatetemp

import (
	"fmt"
	"os"
	"syscall"
)

func createOwnedDirectory(path string) error {
	return os.Mkdir(path, 0o700)
}

func createOwnedFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
}

func validateOwnedPath(path string, info os.FileInfo, directory bool) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return fmt.Errorf("updater temp path is not owned by the current user: %s", path)
	}
	permissions := info.Mode().Perm()
	if directory {
		if permissions != 0o700 {
			return fmt.Errorf("updater temp root must have owner-only rwx permissions: %s", path)
		}
		return nil
	}
	if permissions&0o077 != 0 {
		return fmt.Errorf("updater temp ownership marker must have owner-only permissions: %s", path)
	}
	return nil
}
