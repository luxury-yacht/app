//go:build !windows

package windowsinstall

func LegacyMachineInstall(string) bool {
	return false
}
