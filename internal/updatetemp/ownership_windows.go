//go:build windows

package updatetemp

import (
	"fmt"
	"os"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

const fileAllAccessMask windows.ACCESS_MASK = windows.STANDARD_RIGHTS_REQUIRED | windows.SYNCHRONIZE | 0x1ff

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

func ensureOwnedPath(path string, info os.FileInfo, directory bool) error {
	token := windows.GetCurrentProcessToken()
	userSID, err := currentProcessUserSID(token)
	if err != nil {
		return fmt.Errorf("read current process user SID: %w", err)
	}
	defaultOwner, err := tokenDefaultOwnerSID(token)
	if err != nil {
		return fmt.Errorf("read current process default owner SID: %w", err)
	}
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
	pathOwnerSID := ""
	if owner != nil {
		pathOwnerSID = owner.String()
	}
	userSIDString := userSID.String()
	defaultOwnerSID := defaultOwner.String()
	if !ownerSIDCanBeMigrated(pathOwnerSID, userSIDString, defaultOwnerSID) {
		return fmt.Errorf(
			"updater temp path is not owned by the current process: %s (path owner: %s; process user: %s; process default owner: %s)",
			path,
			pathOwnerSID,
			userSIDString,
			defaultOwnerSID,
		)
	}
	if err := setPrivatePathSecurity(path, userSID, directory); err != nil {
		return fmt.Errorf("secure updater temp path for the current user %s: %w", path, err)
	}
	return validateOwnedPath(path, info, directory)
}

func validateOwnedPath(path string, _ os.FileInfo, directory bool) error {
	descriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return fmt.Errorf("read updater temp path security %s: %w", path, err)
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
	control, _, err := descriptor.Control()
	if err != nil {
		return fmt.Errorf("read updater temp path security control %s: %w", path, err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return fmt.Errorf("updater temp path DACL must be protected from inheritance: %s", path)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return fmt.Errorf("read updater temp path DACL %s: %w", path, err)
	}
	if dacl == nil || dacl.AceCount != 1 {
		return fmt.Errorf("updater temp path must grant access only to the current user: %s", path)
	}
	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(dacl, 0, &ace); err != nil {
		return fmt.Errorf("read updater temp path access entry %s: %w", path, err)
	}
	if ace == nil {
		return fmt.Errorf("updater temp path access entry is missing: %s", path)
	}
	wantFlags := uint8(0)
	if directory {
		wantFlags = windows.OBJECT_INHERIT_ACE | windows.CONTAINER_INHERIT_ACE
	}
	aceSID := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
	if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE ||
		ace.Header.AceFlags != wantFlags ||
		ace.Mask != fileAllAccessMask ||
		!aceSID.Equals(userSID) {
		return fmt.Errorf("updater temp path must grant full access only to the current user: %s", path)
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

func setPrivatePathSecurity(path string, userSID *windows.SID, directory bool) error {
	descriptor, err := privateSecurityDescriptor(userSID, directory)
	if err != nil {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return fmt.Errorf("read private DACL: %w", err)
	}
	err = windows.SetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|
			windows.DACL_SECURITY_INFORMATION|
			windows.PROTECTED_DACL_SECURITY_INFORMATION,
		userSID,
		nil,
		dacl,
		nil,
	)
	runtime.KeepAlive(descriptor)
	return err
}

type tokenOwner struct {
	Owner *windows.SID
}

// Legacy roots created without an explicit security descriptor may use
// TOKEN_OWNER, which is separate from TOKEN_USER and may be Administrators.
func tokenDefaultOwnerSID(token windows.Token) (*windows.SID, error) {
	var required uint32
	err := windows.GetTokenInformation(token, windows.TokenOwner, nil, 0, &required)
	if err != windows.ERROR_INSUFFICIENT_BUFFER {
		return nil, err
	}
	if required < uint32(unsafe.Sizeof(tokenOwner{})) {
		return nil, fmt.Errorf("invalid TOKEN_OWNER size: %d", required)
	}

	buffer := make([]byte, required)
	if err := windows.GetTokenInformation(
		token,
		windows.TokenOwner,
		&buffer[0],
		uint32(len(buffer)),
		&required,
	); err != nil {
		return nil, err
	}
	owner := (*tokenOwner)(unsafe.Pointer(&buffer[0])).Owner
	if owner == nil {
		return nil, fmt.Errorf("TOKEN_OWNER did not contain an owner SID")
	}
	return owner.Copy()
}
