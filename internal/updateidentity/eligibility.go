package updateidentity

import (
	"encoding/json"
	"path/filepath"
	"strings"
)

const (
	ProductIdentifier      = "app.luxury-yacht.desktop"
	InstallationMarkerName = "luxury-yacht.install.json"
)

type Platform string

const (
	PlatformDarwin  Platform = "darwin"
	PlatformWindows Platform = "windows"
	PlatformLinux   Platform = "linux"
)

type Distribution string

const (
	DistributionMacBundle     Distribution = "mac-bundle"
	DistributionWindowsNSIS   Distribution = "windows-nsis"
	DistributionLinuxPortable Distribution = "linux-portable"
	DistributionLinuxDEB      Distribution = "linux-deb"
	DistributionLinuxRPM      Distribution = "linux-rpm"
)

type EligibilityReason string

const (
	ReasonMacNotInstalledBundle    EligibilityReason = "mac-not-installed-bundle"
	ReasonMacReadOnly              EligibilityReason = "mac-read-only"
	ReasonMacUnwritableParent      EligibilityReason = "mac-unwritable-parent"
	ReasonWindowsMachineScope      EligibilityReason = "windows-machine-scope"
	ReasonWindowsUnverifiedInstall EligibilityReason = "windows-unverified-install"
	ReasonLinuxPackageManaged      EligibilityReason = "linux-package-managed"
	ReasonLinuxPortableIneligible  EligibilityReason = "linux-portable-ineligible"
	ReasonUnsupportedDistribution  EligibilityReason = "unsupported-distribution"
)

type RecoveryTarget string

const (
	RecoveryMacDownload             RecoveryTarget = "mac-download"
	RecoveryWindowsDownload         RecoveryTarget = "windows-download"
	RecoveryWindowsPerUserMigration RecoveryTarget = "windows-per-user-migration"
	RecoveryLinuxPackages           RecoveryTarget = "linux-packages"
	RecoveryLinuxPortableDownload   RecoveryTarget = "linux-portable-download"
	RecoveryDownloadOptions         RecoveryTarget = "download-options"
)

// MarkerCandidate is the exact marker path and content observed by a platform
// probe. ResolveInstallation validates both rather than trusting a caller's
// distribution classification.
type MarkerCandidate struct {
	Path string
	Data []byte
}

// InstallationProbe contains filesystem evidence gathered for the running
// target. The resolver remains deterministic and does not access the host.
type InstallationProbe struct {
	Platform                    Platform
	Architecture                string
	TargetPath                  string
	MacInstalledBundle          bool
	VolumeReadOnly              bool
	ParentWritable              bool
	PackageManagedTarget        bool
	WindowsLegacyMachineInstall bool
	Marker                      *MarkerCandidate
	PackageMarker               *MarkerCandidate
}

// InstallationEligibility distinguishes release discovery from in-place
// replacement because valid package-managed installations still check for
// updates while never staging them.
type InstallationEligibility struct {
	CanCheck     bool
	CanInstall   bool
	Distribution Distribution
	Reason       EligibilityReason
	Recovery     RecoveryTarget
}

type installationMarker struct {
	SchemaVersion     int    `json:"schemaVersion"`
	ProductIdentifier string `json:"productIdentifier"`
	Distribution      string `json:"distribution"`
	Scope             string `json:"scope"`
}

func ResolveInstallation(probe InstallationProbe) InstallationEligibility {
	if probe.Architecture != "amd64" && probe.Architecture != "arm64" {
		return unsupportedInstallation()
	}

	switch probe.Platform {
	case PlatformDarwin:
		return resolveMacInstallation(probe)
	case PlatformWindows:
		return resolveWindowsInstallation(probe)
	case PlatformLinux:
		return resolveLinuxInstallation(probe)
	default:
		return unsupportedInstallation()
	}
}

func resolveMacInstallation(probe InstallationProbe) InstallationEligibility {
	if !probe.MacInstalledBundle {
		return InstallationEligibility{
			Reason:   ReasonMacNotInstalledBundle,
			Recovery: RecoveryMacDownload,
		}
	}
	result := InstallationEligibility{
		CanCheck:     true,
		Distribution: DistributionMacBundle,
	}
	if probe.VolumeReadOnly {
		result.Reason = ReasonMacReadOnly
		result.Recovery = RecoveryMacDownload
		return result
	}
	if !probe.ParentWritable {
		result.Reason = ReasonMacUnwritableParent
		result.Recovery = RecoveryMacDownload
		return result
	}
	result.CanInstall = true
	return result
}

func resolveWindowsInstallation(probe InstallationProbe) InstallationEligibility {
	marker, ok := validAdjacentMarker(probe.Platform, probe.TargetPath, probe.Marker)
	if !ok {
		if probe.Marker == nil && probe.WindowsLegacyMachineInstall {
			return InstallationEligibility{
				CanCheck: true, Distribution: DistributionWindowsNSIS,
				Reason: ReasonWindowsMachineScope, Recovery: RecoveryWindowsPerUserMigration,
			}
		}
		return InstallationEligibility{
			Reason:   ReasonWindowsUnverifiedInstall,
			Recovery: RecoveryWindowsDownload,
		}
	}
	if marker.Distribution != "nsis" {
		return InstallationEligibility{
			Reason:   ReasonWindowsUnverifiedInstall,
			Recovery: RecoveryWindowsDownload,
		}
	}

	result := InstallationEligibility{
		CanCheck:     true,
		Distribution: DistributionWindowsNSIS,
	}
	switch marker.Scope {
	case "user":
		result.CanInstall = true
	case "machine":
		result.Reason = ReasonWindowsMachineScope
		result.Recovery = RecoveryWindowsPerUserMigration
	default:
		return InstallationEligibility{
			Reason:   ReasonWindowsUnverifiedInstall,
			Recovery: RecoveryWindowsDownload,
		}
	}
	return result
}

func resolveLinuxInstallation(probe InstallationProbe) InstallationEligibility {
	if !probe.PackageManagedTarget {
		if portable, ok := resolveLinuxPortableInstallation(probe); ok {
			return portable
		}
	}
	if probe.PackageMarker != nil {
		marker, ok := parseMarker(probe.PackageMarker)
		if !ok || filepath.Clean(probe.PackageMarker.Path) != filepath.Clean(defaultLinuxPackageMarkerPath) || marker.Scope != "system" {
			return unsupportedInstallation()
		}
		distribution := DistributionLinuxDEB
		if marker.Distribution == "rpm" {
			distribution = DistributionLinuxRPM
		} else if marker.Distribution != "deb" {
			return unsupportedInstallation()
		}
		return InstallationEligibility{
			CanCheck:     true,
			Distribution: distribution,
			Reason:       ReasonLinuxPackageManaged,
			Recovery:     RecoveryLinuxPackages,
		}
	}
	return unsupportedInstallation()
}

func resolveLinuxPortableInstallation(probe InstallationProbe) (InstallationEligibility, bool) {
	marker, ok := validAdjacentMarker(probe.Platform, probe.TargetPath, probe.Marker)
	if !ok || marker.Distribution != "portable" || marker.Scope != "user" {
		return InstallationEligibility{}, false
	}
	result := InstallationEligibility{
		CanCheck:     true,
		Distribution: DistributionLinuxPortable,
	}
	if !probe.ParentWritable {
		result.Reason = ReasonLinuxPortableIneligible
		result.Recovery = RecoveryLinuxPortableDownload
		return result, true
	}
	result.CanInstall = true
	return result, true
}

func validAdjacentMarker(platform Platform, targetPath string, candidate *MarkerCandidate) (installationMarker, bool) {
	marker, ok := parseMarker(candidate)
	if !ok {
		return installationMarker{}, false
	}
	expected := filepath.Join(filepath.Dir(targetPath), InstallationMarkerName)
	if !samePath(platform, expected, candidate.Path) {
		return installationMarker{}, false
	}
	return marker, true
}

func parseMarker(candidate *MarkerCandidate) (installationMarker, bool) {
	if candidate == nil || len(candidate.Data) == 0 {
		return installationMarker{}, false
	}
	var marker installationMarker
	if err := json.Unmarshal(candidate.Data, &marker); err != nil {
		return installationMarker{}, false
	}
	if marker.SchemaVersion != 1 || marker.ProductIdentifier != ProductIdentifier {
		return installationMarker{}, false
	}
	return marker, true
}

func samePath(platform Platform, left, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if platform == PlatformWindows {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func unsupportedInstallation() InstallationEligibility {
	return InstallationEligibility{
		Reason:   ReasonUnsupportedDistribution,
		Recovery: RecoveryDownloadOptions,
	}
}
