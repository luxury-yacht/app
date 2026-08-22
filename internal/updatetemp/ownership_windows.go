//go:build windows

package updatetemp

import (
	"fmt"
	"os"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

func createOwnedDirectory(path string) error {
	userSID, err := currentProcessUserSID(windows.GetCurrentProcessToken())
	if err != nil {
		return fmt.Errorf("read current process user SID: %w", err)
	}
	descriptor, err := privateSecurityDescriptor(userSID, true)
	if err != nil {
		return err
	}
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	attributes := windows.SecurityAttributes{
		Length:             uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		SecurityDescriptor: descriptor,
	}
	err = windows.CreateDirectory(pathPointer, &attributes)
	runtime.KeepAlive(descriptor)
	return err
}

func createOwnedFile(path string) (*os.File, error) {
	userSID, err := currentProcessUserSID(windows.GetCurrentProcessToken())
	if err != nil {
		return nil, fmt.Errorf("read current process user SID: %w", err)
	}
	descriptor, err := privateSecurityDescriptor(userSID, false)
	if err != nil {
		return nil, err
	}
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	attributes := windows.SecurityAttributes{
		Length:             uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		SecurityDescriptor: descriptor,
	}
	handle, err := windows.CreateFile(
		pathPointer,
		windows.GENERIC_WRITE,
		0,
		&attributes,
		windows.CREATE_NEW,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	runtime.KeepAlive(descriptor)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(handle), path)
	if file == nil {
		_ = windows.CloseHandle(handle)
		return nil, fmt.Errorf("create updater temp ownership marker file handle")
	}
	return file, nil
}

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
	userSID, err := currentProcessUserSID(windows.GetCurrentProcessToken())
	if err != nil {
		return fmt.Errorf("read current process user SID: %w", err)
	}
	if owner == nil || !owner.Equals(userSID) {
		return fmt.Errorf("updater temp path is not owned by the current user: %s", path)
	}
	return nil
}

func currentProcessUserSID(token windows.Token) (*windows.SID, error) {
	currentUser, err := token.GetTokenUser()
	if err != nil {
		return nil, err
	}
	if currentUser == nil || currentUser.User.Sid == nil {
		return nil, fmt.Errorf("TOKEN_USER did not contain a user SID")
	}
	return currentUser.User.Sid.Copy()
}

func privateSecurityDescriptor(userSID *windows.SID, directory bool) (*windows.SECURITY_DESCRIPTOR, error) {
	if userSID == nil {
		return nil, fmt.Errorf("current process user SID is required")
	}
	userSIDString := userSID.String()
	if userSIDString == "" {
		return nil, fmt.Errorf("format current process user SID")
	}
	inheritance := ""
	if directory {
		inheritance = "OICI"
	}
	selfRelative, err := windows.SecurityDescriptorFromString(
		fmt.Sprintf("O:%sD:P(A;%s;FA;;;%s)", userSIDString, inheritance, userSIDString),
	)
	if err != nil {
		return nil, fmt.Errorf("build private security descriptor: %w", err)
	}
	descriptor, err := selfRelative.ToAbsolute()
	if err != nil {
		return nil, fmt.Errorf("make private security descriptor absolute: %w", err)
	}
	return descriptor, nil
}
