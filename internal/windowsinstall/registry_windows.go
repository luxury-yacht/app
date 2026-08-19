//go:build windows

// Package windowsinstall owns the Windows uninstall-registration identity used
// by legacy installation discovery and post-update Apps & Features repair.
package windowsinstall

import (
	"fmt"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func LegacyMachineInstall(executablePath string) bool {
	return registrationOwnsExecutable(
		registry.LOCAL_MACHINE, UninstallRegistryPath, executablePath,
	)
}

func SetPerUserDisplayVersion(executablePath, version string) error {
	return setPerUserDisplayVersionAt(executablePath, version, UninstallRegistryPath)
}

func setPerUserDisplayVersionAt(executablePath, version, registryPath string) error {
	key, err := registry.OpenKey(
		registry.CURRENT_USER,
		registryPath,
		registry.QUERY_VALUE|registry.SET_VALUE|registry.WOW64_64KEY,
	)
	if err != nil {
		return fmt.Errorf("open per-user Windows uninstall registration: %w", err)
	}
	defer key.Close()
	if !openRegistrationOwnsExecutable(key, executablePath) {
		return fmt.Errorf("refuse Windows Installed Apps metadata update for mismatched registration")
	}
	if err := key.SetStringValue("DisplayVersion", version); err != nil {
		return fmt.Errorf("write per-user Windows DisplayVersion: %w", err)
	}
	return nil
}

func registrationOwnsExecutable(root registry.Key, registryPath, executablePath string) bool {
	key, err := registry.OpenKey(
		root,
		registryPath,
		registry.QUERY_VALUE|registry.WOW64_64KEY,
	)
	if err != nil {
		return false
	}
	defer key.Close()
	return openRegistrationOwnsExecutable(key, executablePath)
}

func openRegistrationOwnsExecutable(key registry.Key, executablePath string) bool {
	displayName, _, nameErr := key.GetStringValue("DisplayName")
	displayIcon, _, iconErr := key.GetStringValue("DisplayIcon")
	uninstall, _, uninstallErr := key.GetStringValue("UninstallString")
	if nameErr != nil || iconErr != nil || uninstallErr != nil || displayName != ProductName {
		return false
	}
	cleanExecutable := filepath.Clean(strings.Trim(strings.TrimSpace(executablePath), `"`))
	cleanIcon := filepath.Clean(strings.Trim(strings.TrimSpace(displayIcon), `"`))
	cleanUninstaller := filepath.Clean(strings.Trim(strings.TrimSpace(uninstall), `"`))
	return strings.EqualFold(cleanExecutable, cleanIcon) &&
		strings.EqualFold(filepath.Join(filepath.Dir(cleanExecutable), "uninstall.exe"), cleanUninstaller)
}
