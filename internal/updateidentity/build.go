package updateidentity

import (
	"strings"
	"time"
)

type BuildStatus string

const (
	BuildEnabled                BuildStatus = "enabled"
	BuildDisabledDevelopment    BuildStatus = "disabled-development"
	BuildDisabledServer         BuildStatus = "disabled-server"
	BuildDisabledInvalidVersion BuildStatus = "disabled-invalid-version"
	BuildDisabledInstallation   BuildStatus = "disabled-installation"
	BuildDisabledPayload        BuildStatus = "disabled-payload"
	BuildExpiredBeta            BuildStatus = "expired-beta"
)

type BuildProbe struct {
	Version          string
	Server           bool
	BetaExpiry       time.Time
	Now              time.Time
	PayloadAvailable bool
	Installation     InstallationEligibility
}

type BuildEligibility struct {
	Status        BuildStatus
	Release       ReleaseVersion
	Installation  InstallationEligibility
	Recovery      RecoveryTarget
	CanInitialize bool
	CanCheck      bool
	CanInstall    bool
}

func ResolveBuild(probe BuildProbe) BuildEligibility {
	result := BuildEligibility{Installation: probe.Installation}
	if probe.Server {
		result.Status = BuildDisabledServer
		return result
	}
	if isDevelopmentVersion(probe.Version) {
		result.Status = BuildDisabledDevelopment
		return result
	}

	release, err := ParseReleaseVersion(probe.Version)
	if err != nil {
		result.Status = BuildDisabledInvalidVersion
		return result
	}
	result.Release = release

	if release.Channel == ChannelBeta && !probe.BetaExpiry.IsZero() && !probe.Now.Before(probe.BetaExpiry) {
		result.Status = BuildExpiredBeta
		result.Recovery = RecoveryForDistribution(probe.Installation.Distribution)
		return result
	}
	if !probe.Installation.CanCheck {
		result.Status = BuildDisabledInstallation
		return result
	}
	if !probe.PayloadAvailable {
		result.Status = BuildDisabledPayload
		return result
	}

	result.Status = BuildEnabled
	result.CanInitialize = true
	result.CanCheck = true
	result.CanInstall = probe.Installation.CanInstall
	return result
}

func isDevelopmentVersion(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "" || normalized == "dev" || strings.HasSuffix(normalized, " (dev)")
}

func RecoveryForDistribution(distribution Distribution) RecoveryTarget {
	switch distribution {
	case DistributionMacBundle:
		return RecoveryMacDownload
	case DistributionWindowsNSIS:
		return RecoveryWindowsDownload
	case DistributionLinuxPortable:
		return RecoveryLinuxPortableDownload
	case DistributionLinuxDEB, DistributionLinuxRPM:
		return RecoveryLinuxPackages
	default:
		return RecoveryDownloadOptions
	}
}
