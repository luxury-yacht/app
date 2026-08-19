package updateidentity_test

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

func TestResolveBuildGatesUpdaterInitializationAndInstallation(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	installable := updateidentity.InstallationEligibility{
		CanCheck: true, CanInstall: true, Distribution: updateidentity.DistributionMacBundle,
	}
	notificationOnly := updateidentity.InstallationEligibility{
		CanCheck: true, Distribution: updateidentity.DistributionLinuxDEB,
		Reason: updateidentity.ReasonLinuxPackageManaged, Recovery: updateidentity.RecoveryLinuxPackages,
	}

	tests := []struct {
		name  string
		probe updateidentity.BuildProbe
		want  updateidentity.BuildEligibility
	}{
		{
			name: "eligible stable desktop",
			probe: updateidentity.BuildProbe{
				Version: "v2.0.0", Now: now, Installation: installable, PayloadAvailable: true,
			},
			want: updateidentity.BuildEligibility{
				Status:        updateidentity.BuildEnabled,
				Release:       updateidentity.ReleaseVersion{Version: "2.0.0", Channel: updateidentity.ChannelStable},
				Installation:  installable,
				CanInitialize: true, CanCheck: true, CanInstall: true,
			},
		},
		{
			name: "valid package installation is notification-only",
			probe: updateidentity.BuildProbe{
				Version: "v2.0.0", Now: now, Installation: notificationOnly, PayloadAvailable: true,
			},
			want: updateidentity.BuildEligibility{
				Status:        updateidentity.BuildEnabled,
				Release:       updateidentity.ReleaseVersion{Version: "2.0.0", Channel: updateidentity.ChannelStable},
				Installation:  notificationOnly,
				CanInitialize: true, CanCheck: true,
			},
		},
		{
			name: "recognized installation without published updater payload",
			probe: updateidentity.BuildProbe{
				Version: "v2.0.0", Now: now, Installation: installable,
			},
			want: updateidentity.BuildEligibility{
				Status:       updateidentity.BuildDisabledPayload,
				Release:      updateidentity.ReleaseVersion{Version: "2.0.0", Channel: updateidentity.ChannelStable},
				Installation: installable,
			},
		},
		{
			name:  "development build",
			probe: updateidentity.BuildProbe{Version: "dev", Now: now, Installation: installable},
			want:  updateidentity.BuildEligibility{Status: updateidentity.BuildDisabledDevelopment, Installation: installable},
		},
		{
			name:  "server build",
			probe: updateidentity.BuildProbe{Version: "v2.0.0", Server: true, Now: now, Installation: installable},
			want:  updateidentity.BuildEligibility{Status: updateidentity.BuildDisabledServer, Installation: installable},
		},
		{
			name:  "invalid release version",
			probe: updateidentity.BuildProbe{Version: "2.0", Now: now, Installation: installable},
			want:  updateidentity.BuildEligibility{Status: updateidentity.BuildDisabledInvalidVersion, Installation: installable},
		},
		{
			name: "expired beta uses manual recovery only",
			probe: updateidentity.BuildProbe{
				Version: "v2.0.0-beta.3", BetaExpiry: now.Add(-time.Hour), Now: now, Installation: installable,
			},
			want: updateidentity.BuildEligibility{
				Status:       updateidentity.BuildExpiredBeta,
				Release:      updateidentity.ReleaseVersion{Version: "2.0.0-beta.3", Channel: updateidentity.ChannelBeta},
				Installation: installable,
				Recovery:     updateidentity.RecoveryMacDownload,
			},
		},
		{
			name: "unverified installation",
			probe: updateidentity.BuildProbe{
				Version: "v2.0.0", Now: now, PayloadAvailable: true,
				Installation: updateidentity.InstallationEligibility{
					Reason: updateidentity.ReasonWindowsUnverifiedInstall, Recovery: updateidentity.RecoveryWindowsDownload,
				},
			},
			want: updateidentity.BuildEligibility{
				Status:  updateidentity.BuildDisabledInstallation,
				Release: updateidentity.ReleaseVersion{Version: "2.0.0", Channel: updateidentity.ChannelStable},
				Installation: updateidentity.InstallationEligibility{
					Reason: updateidentity.ReasonWindowsUnverifiedInstall, Recovery: updateidentity.RecoveryWindowsDownload,
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			require.Equal(t, test.want, updateidentity.ResolveBuild(test.probe))
		})
	}
}
