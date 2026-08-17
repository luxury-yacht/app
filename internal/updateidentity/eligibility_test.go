package updateidentity_test

import (
	"path/filepath"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

func TestResolveInstallationSupportsEachApprovedDistribution(t *testing.T) {
	t.Parallel()

	validMarker := func(executablePath, distribution, scope string) *updateidentity.MarkerCandidate {
		return &updateidentity.MarkerCandidate{
			Path: filepath.Join(filepath.Dir(executablePath), "luxury-yacht.install.json"),
			Data: []byte(`{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"` + distribution + `","scope":"` + scope + `"}`),
		}
	}

	tests := []struct {
		name  string
		probe updateidentity.InstallationProbe
		want  updateidentity.InstallationEligibility
	}{
		{
			name: "macOS installed bundle",
			probe: updateidentity.InstallationProbe{
				Platform:           updateidentity.PlatformDarwin,
				Architecture:       "arm64",
				TargetPath:         "/Applications/Luxury Yacht.app",
				MacInstalledBundle: true,
				ParentWritable:     true,
			},
			want: updateidentity.InstallationEligibility{
				CanCheck:     true,
				CanInstall:   true,
				Distribution: updateidentity.DistributionMacBundle,
			},
		},
		{
			name: "Windows per-user NSIS",
			probe: func() updateidentity.InstallationProbe {
				executable := filepath.Join("C:", "Users", "alice", "AppData", "Local", "Luxury Yacht", "luxury-yacht.exe")
				return updateidentity.InstallationProbe{
					Platform:     updateidentity.PlatformWindows,
					Architecture: "amd64",
					TargetPath:   executable,
					Marker:       validMarker(executable, "nsis", "user"),
				}
			}(),
			want: updateidentity.InstallationEligibility{
				CanCheck:     true,
				CanInstall:   true,
				Distribution: updateidentity.DistributionWindowsNSIS,
			},
		},
		{
			name: "Windows machine-scope NSIS",
			probe: func() updateidentity.InstallationProbe {
				executable := filepath.Join("C:", "Program Files", "Luxury Yacht", "luxury-yacht.exe")
				return updateidentity.InstallationProbe{
					Platform:     updateidentity.PlatformWindows,
					Architecture: "arm64",
					TargetPath:   executable,
					Marker:       validMarker(executable, "nsis", "machine"),
				}
			}(),
			want: updateidentity.InstallationEligibility{
				CanCheck:     true,
				Distribution: updateidentity.DistributionWindowsNSIS,
				Reason:       updateidentity.ReasonWindowsMachineScope,
				Recovery:     updateidentity.RecoveryWindowsPerUserMigration,
			},
		},
		{
			name: "Linux portable",
			probe: func() updateidentity.InstallationProbe {
				executable := filepath.Join("/home/alice/Applications/luxury-yacht", "luxury-yacht")
				return updateidentity.InstallationProbe{
					Platform:       updateidentity.PlatformLinux,
					Architecture:   "arm64",
					TargetPath:     executable,
					TargetWritable: true,
					ParentWritable: true,
					Marker:         validMarker(executable, "portable", "user"),
				}
			}(),
			want: updateidentity.InstallationEligibility{
				CanCheck:     true,
				CanInstall:   true,
				Distribution: updateidentity.DistributionLinuxPortable,
			},
		},
		{
			name: "Linux DEB package",
			probe: updateidentity.InstallationProbe{
				Platform:     updateidentity.PlatformLinux,
				Architecture: "amd64",
				TargetPath:   "/usr/local/bin/luxury-yacht",
				PackageMarker: &updateidentity.MarkerCandidate{
					Path: "/usr/share/luxury-yacht/install.json",
					Data: []byte(`{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"deb","scope":"system"}`),
				},
			},
			want: updateidentity.InstallationEligibility{
				CanCheck:     true,
				Distribution: updateidentity.DistributionLinuxDEB,
				Reason:       updateidentity.ReasonLinuxPackageManaged,
				Recovery:     updateidentity.RecoveryLinuxPackages,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			got := updateidentity.ResolveInstallation(test.probe)

			require.Equal(t, test.want, got)
		})
	}
}

func TestResolveInstallationRejectsUnverifiedOrUnreplaceableTargets(t *testing.T) {
	t.Parallel()

	linuxExecutable := "/home/alice/Applications/luxury-yacht/luxury-yacht"
	portableMarker := &updateidentity.MarkerCandidate{
		Path: filepath.Join(filepath.Dir(linuxExecutable), "luxury-yacht.install.json"),
		Data: []byte(`{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"portable","scope":"user"}`),
	}
	windowsExecutable := filepath.Join("C:", "Users", "alice", "AppData", "Local", "Luxury Yacht", "luxury-yacht.exe")
	windowsMarkerPath := filepath.Join(filepath.Dir(windowsExecutable), "luxury-yacht.install.json")

	tests := []struct {
		name  string
		probe updateidentity.InstallationProbe
		want  updateidentity.InstallationEligibility
	}{
		{
			name: "macOS unsupported path",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformDarwin, Architecture: "arm64",
			},
			want: updateidentity.InstallationEligibility{
				Reason: updateidentity.ReasonMacNotInstalledBundle, Recovery: updateidentity.RecoveryMacDownload,
			},
		},
		{
			name: "macOS read-only volume",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformDarwin, Architecture: "amd64",
				MacInstalledBundle: true, VolumeReadOnly: true, ParentWritable: true,
			},
			want: updateidentity.InstallationEligibility{
				CanCheck: true, Distribution: updateidentity.DistributionMacBundle,
				Reason: updateidentity.ReasonMacReadOnly, Recovery: updateidentity.RecoveryMacDownload,
			},
		},
		{
			name: "macOS unwritable parent",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformDarwin, Architecture: "amd64",
				MacInstalledBundle: true,
			},
			want: updateidentity.InstallationEligibility{
				CanCheck: true, Distribution: updateidentity.DistributionMacBundle,
				Reason: updateidentity.ReasonMacUnwritableParent, Recovery: updateidentity.RecoveryMacDownload,
			},
		},
		{
			name: "Windows missing marker",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformWindows, Architecture: "amd64", TargetPath: windowsExecutable,
			},
			want: updateidentity.InstallationEligibility{
				Reason: updateidentity.ReasonWindowsUnverifiedInstall, Recovery: updateidentity.RecoveryWindowsDownload,
			},
		},
		{
			name: "Windows malformed marker",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformWindows, Architecture: "amd64", TargetPath: windowsExecutable,
				Marker: &updateidentity.MarkerCandidate{Path: windowsMarkerPath, Data: []byte(`{"schemaVersion":`)},
			},
			want: updateidentity.InstallationEligibility{
				Reason: updateidentity.ReasonWindowsUnverifiedInstall, Recovery: updateidentity.RecoveryWindowsDownload,
			},
		},
		{
			name: "Windows mismatched product",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformWindows, Architecture: "amd64", TargetPath: windowsExecutable,
				Marker: &updateidentity.MarkerCandidate{Path: windowsMarkerPath, Data: []byte(`{"schemaVersion":1,"productIdentifier":"app.example.other","distribution":"nsis","scope":"user"}`)},
			},
			want: updateidentity.InstallationEligibility{
				Reason: updateidentity.ReasonWindowsUnverifiedInstall, Recovery: updateidentity.RecoveryWindowsDownload,
			},
		},
		{
			name: "Windows non-adjacent marker",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformWindows, Architecture: "amd64", TargetPath: windowsExecutable,
				Marker: &updateidentity.MarkerCandidate{Path: filepath.Join(filepath.Dir(filepath.Dir(windowsExecutable)), "luxury-yacht.install.json"), Data: []byte(`{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"nsis","scope":"user"}`)},
			},
			want: updateidentity.InstallationEligibility{
				Reason: updateidentity.ReasonWindowsUnverifiedInstall, Recovery: updateidentity.RecoveryWindowsDownload,
			},
		},
		{
			name: "Linux portable non-writable target",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "arm64", TargetPath: linuxExecutable,
				Marker: portableMarker, ParentWritable: true,
			},
			want: updateidentity.InstallationEligibility{
				CanCheck: true, Distribution: updateidentity.DistributionLinuxPortable,
				Reason: updateidentity.ReasonLinuxPortableIneligible, Recovery: updateidentity.RecoveryLinuxPortableDownload,
			},
		},
		{
			name: "Linux package-owned target cannot claim portable identity",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "arm64", TargetPath: linuxExecutable,
				Marker: portableMarker, TargetWritable: true, ParentWritable: true, PackageManagedTarget: true,
			},
			want: updateidentity.InstallationEligibility{
				Reason: updateidentity.ReasonUnsupportedDistribution, Recovery: updateidentity.RecoveryDownloadOptions,
			},
		},
		{
			name: "Linux malformed package marker",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: "/usr/local/bin/luxury-yacht",
				PackageMarker: &updateidentity.MarkerCandidate{Path: "/usr/share/luxury-yacht/install.json", Data: []byte(`{`)},
			},
			want: updateidentity.InstallationEligibility{
				Reason: updateidentity.ReasonUnsupportedDistribution, Recovery: updateidentity.RecoveryDownloadOptions,
			},
		},
		{
			name: "unsupported architecture",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "386", TargetPath: linuxExecutable,
				Marker: portableMarker, TargetWritable: true, ParentWritable: true,
			},
			want: updateidentity.InstallationEligibility{
				Reason: updateidentity.ReasonUnsupportedDistribution, Recovery: updateidentity.RecoveryDownloadOptions,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			require.Equal(t, test.want, updateidentity.ResolveInstallation(test.probe))
		})
	}
}

func TestResolveInstallationValidatesEveryMarkerIdentityField(t *testing.T) {
	t.Parallel()

	windowsExecutable := "/users/alice/luxury-yacht/luxury-yacht.exe"
	windowsMarkerPath := filepath.Join(filepath.Dir(windowsExecutable), updateidentity.InstallationMarkerName)
	linuxExecutable := "/home/alice/luxury-yacht/luxury-yacht"
	linuxMarkerPath := filepath.Join(filepath.Dir(linuxExecutable), updateidentity.InstallationMarkerName)
	packageMarkerPath := "/usr/share/luxury-yacht/install.json"

	windowsUnverified := updateidentity.InstallationEligibility{
		Reason: updateidentity.ReasonWindowsUnverifiedInstall, Recovery: updateidentity.RecoveryWindowsDownload,
	}
	unsupported := updateidentity.InstallationEligibility{
		Reason: updateidentity.ReasonUnsupportedDistribution, Recovery: updateidentity.RecoveryDownloadOptions,
	}

	tests := []struct {
		name  string
		probe updateidentity.InstallationProbe
		want  updateidentity.InstallationEligibility
	}{
		{
			name: "Windows wrong scope",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformWindows, Architecture: "amd64", TargetPath: windowsExecutable,
				Marker: marker(windowsMarkerPath, "app.luxury-yacht.desktop", "nsis", "system"),
			},
			want: windowsUnverified,
		},
		{
			name: "Windows wrong distribution",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformWindows, Architecture: "amd64", TargetPath: windowsExecutable,
				Marker: marker(windowsMarkerPath, "app.luxury-yacht.desktop", "portable", "user"),
			},
			want: windowsUnverified,
		},
		{
			name: "Linux portable missing marker",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: linuxExecutable,
				TargetWritable: true, ParentWritable: true,
			},
			want: unsupported,
		},
		{
			name: "Linux portable malformed marker",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: linuxExecutable,
				Marker:         &updateidentity.MarkerCandidate{Path: linuxMarkerPath, Data: []byte(`{`)},
				TargetWritable: true, ParentWritable: true,
			},
			want: unsupported,
		},
		{
			name: "Linux portable mismatched product",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: linuxExecutable,
				Marker:         marker(linuxMarkerPath, "app.example.other", "portable", "user"),
				TargetWritable: true, ParentWritable: true,
			},
			want: unsupported,
		},
		{
			name: "Linux portable non-adjacent marker",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: linuxExecutable,
				Marker:         marker(filepath.Join(filepath.Dir(filepath.Dir(linuxExecutable)), updateidentity.InstallationMarkerName), "app.luxury-yacht.desktop", "portable", "user"),
				TargetWritable: true, ParentWritable: true,
			},
			want: unsupported,
		},
		{
			name: "Linux package missing marker",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: "/usr/local/bin/luxury-yacht",
				PackageManagedTarget: true,
			},
			want: unsupported,
		},
		{
			name: "Linux package mismatched product",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: "/usr/local/bin/luxury-yacht",
				PackageMarker: marker(packageMarkerPath, "app.example.other", "deb", "system"),
			},
			want: unsupported,
		},
		{
			name: "Linux package wrong scope",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: "/usr/local/bin/luxury-yacht",
				PackageMarker: marker(packageMarkerPath, "app.luxury-yacht.desktop", "deb", "user"),
			},
			want: unsupported,
		},
		{
			name: "Linux package noncanonical marker path",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: "/usr/local/bin/luxury-yacht",
				PackageMarker: marker("/tmp/install.json", "app.luxury-yacht.desktop", "deb", "system"),
			},
			want: unsupported,
		},
		{
			name: "Linux RPM package",
			probe: updateidentity.InstallationProbe{
				Platform: updateidentity.PlatformLinux, Architecture: "arm64", TargetPath: "/usr/local/bin/luxury-yacht",
				PackageMarker: marker(packageMarkerPath, "app.luxury-yacht.desktop", "rpm", "system"),
			},
			want: updateidentity.InstallationEligibility{
				CanCheck: true, Distribution: updateidentity.DistributionLinuxRPM,
				Reason: updateidentity.ReasonLinuxPackageManaged, Recovery: updateidentity.RecoveryLinuxPackages,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			require.Equal(t, test.want, updateidentity.ResolveInstallation(test.probe))
		})
	}
}

func TestResolveInstallationKeepsPortableIdentityWhenAnotherPackageIsInstalled(t *testing.T) {
	t.Parallel()
	executable := "/home/alice/.local/share/luxury-yacht/luxury-yacht"

	eligibility := updateidentity.ResolveInstallation(updateidentity.InstallationProbe{
		Platform:       updateidentity.PlatformLinux,
		Architecture:   "amd64",
		TargetPath:     executable,
		TargetWritable: true,
		ParentWritable: true,
		Marker: marker(
			filepath.Join(filepath.Dir(executable), updateidentity.InstallationMarkerName),
			"app.luxury-yacht.desktop",
			"portable",
			"user",
		),
		PackageMarker: marker(
			"/usr/share/luxury-yacht/install.json",
			"app.luxury-yacht.desktop",
			"deb",
			"system",
		),
	})

	require.Equal(t, updateidentity.InstallationEligibility{
		CanCheck: true, CanInstall: true, Distribution: updateidentity.DistributionLinuxPortable,
	}, eligibility)
}

func marker(path, product, distribution, scope string) *updateidentity.MarkerCandidate {
	return &updateidentity.MarkerCandidate{
		Path: path,
		Data: []byte(`{"schemaVersion":1,"productIdentifier":"` + product + `","distribution":"` + distribution + `","scope":"` + scope + `"}`),
	}
}
