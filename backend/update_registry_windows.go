//go:build windows

package backend

import (
	"fmt"
	"os"
	"runtime"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/luxury-yacht/app/internal/windowsinstall"
)

func reconcileWindowsDisplayVersion(version string) error {
	executablePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable for Windows Installed Apps metadata: %w", err)
	}
	displayVersion, err := windowsDisplayVersion(version)
	if err != nil {
		return err
	}
	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.PlatformWindows, Architecture: runtime.GOARCH,
		ExecutablePath: executablePath,
	})
	if err != nil {
		return fmt.Errorf("validate per-user Windows installation marker: %w", err)
	}
	eligibility := updateidentity.ResolveInstallation(probe)
	if !eligibility.CanInstall || eligibility.Distribution != updateidentity.DistributionWindowsNSIS {
		return fmt.Errorf("refuse Windows Installed Apps metadata update for unverified per-user installation")
	}

	return windowsinstall.SetPerUserDisplayVersion(executablePath, displayVersion)
}
