//go:build windows

package updatetemp

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func validateOwnedPath(path string, _ os.FileInfo, _ bool) error {
	descriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION,
	)
	if err != nil {
		return fmt.Errorf("read updater temp path owner %s: %w", path, err)
	}
	owner, _, err := descriptor.Owner()
	if err != nil {
		return fmt.Errorf("read updater temp path owner SID %s: %w", path, err)
	}
	currentUser, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return fmt.Errorf("read current user SID: %w", err)
	}
	if owner == nil || !owner.Equals(currentUser.User.Sid) {
		return fmt.Errorf("updater temp path is not owned by the current user: %s", path)
	}
	return nil
}
