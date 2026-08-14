package updateidentity_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

func TestCollectInstallationProbeResolvesInstalledMacBundle(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	bundle := filepath.Join(home, "Applications", "Luxury Yacht.app")
	executable := filepath.Join(bundle, "Contents", "MacOS", "luxury-yacht")
	require.NoError(t, os.MkdirAll(filepath.Dir(executable), 0o755))
	require.NoError(t, os.WriteFile(executable, []byte("binary"), 0o700))

	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.PlatformDarwin, Architecture: "arm64",
		ExecutablePath: executable, HomeDirectory: home,
	})

	require.NoError(t, err)
	require.Equal(t, bundle, probe.TargetPath)
	require.True(t, probe.MacInstalledBundle)
	require.False(t, probe.VolumeReadOnly)
	require.True(t, probe.ParentWritable)
	require.Equal(t, updateidentity.InstallationEligibility{
		CanCheck: true, CanInstall: true, Distribution: updateidentity.DistributionMacBundle,
	}, updateidentity.ResolveInstallation(probe))
}

func TestCollectInstallationProbeRejectsMacBundleOutsideApplications(t *testing.T) {
	t.Parallel()

	home := t.TempDir()
	bundle := filepath.Join(home, "Downloads", "Luxury Yacht.app")
	executable := filepath.Join(bundle, "Contents", "MacOS", "luxury-yacht")
	require.NoError(t, os.MkdirAll(filepath.Dir(executable), 0o755))
	require.NoError(t, os.WriteFile(executable, []byte("binary"), 0o700))

	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.PlatformDarwin, Architecture: "arm64",
		ExecutablePath: executable, HomeDirectory: home,
	})

	require.NoError(t, err)
	require.Equal(t, bundle, probe.TargetPath)
	require.False(t, probe.MacInstalledBundle)
	require.Equal(t, updateidentity.ReasonMacNotInstalledBundle, updateidentity.ResolveInstallation(probe).Reason)
}

func TestCollectInstallationProbeReadsOnlyAdjacentWindowsMarker(t *testing.T) {
	t.Parallel()

	installDirectory := t.TempDir()
	executable := filepath.Join(installDirectory, "luxury-yacht.exe")
	require.NoError(t, os.WriteFile(executable, []byte("binary"), 0o700))
	markerPath := filepath.Join(installDirectory, updateidentity.InstallationMarkerName)
	markerData := []byte(`{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"nsis","scope":"user"}`)
	require.NoError(t, os.WriteFile(markerPath, markerData, 0o600))

	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.PlatformWindows, Architecture: "amd64", ExecutablePath: executable,
	})

	require.NoError(t, err)
	require.Equal(t, &updateidentity.MarkerCandidate{Path: markerPath, Data: markerData}, probe.Marker)
	require.Equal(t, updateidentity.InstallationEligibility{
		CanCheck: true, CanInstall: true, Distribution: updateidentity.DistributionWindowsNSIS,
	}, updateidentity.ResolveInstallation(probe))
}

func TestCollectInstallationProbeValidatesPortableLinuxReplaceability(t *testing.T) {
	t.Parallel()

	installDirectory := t.TempDir()
	executable := filepath.Join(installDirectory, "luxury-yacht")
	require.NoError(t, os.WriteFile(executable, []byte("binary"), 0o700))
	markerPath := filepath.Join(installDirectory, updateidentity.InstallationMarkerName)
	markerData := []byte(`{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"portable","scope":"user"}`)
	require.NoError(t, os.WriteFile(markerPath, markerData, 0o600))

	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.PlatformLinux, Architecture: "arm64", ExecutablePath: executable,
		PackageMarkerPath: filepath.Join(t.TempDir(), "missing-package-marker.json"),
	})

	require.NoError(t, err)
	require.Equal(t, &updateidentity.MarkerCandidate{Path: markerPath, Data: markerData}, probe.Marker)
	require.True(t, probe.TargetWritable)
	require.True(t, probe.ParentWritable)
	require.False(t, probe.PackageManagedTarget)
	require.Equal(t, updateidentity.InstallationEligibility{
		CanCheck: true, CanInstall: true, Distribution: updateidentity.DistributionLinuxPortable,
	}, updateidentity.ResolveInstallation(probe))
}

func TestCollectInstallationProbeDoesNotTrustSymlinkedMarker(t *testing.T) {
	t.Parallel()

	installDirectory := t.TempDir()
	executable := filepath.Join(installDirectory, "luxury-yacht.exe")
	require.NoError(t, os.WriteFile(executable, []byte("binary"), 0o700))
	realMarker := filepath.Join(t.TempDir(), "install.json")
	require.NoError(t, os.WriteFile(realMarker, []byte(`{"schemaVersion":1}`), 0o600))
	require.NoError(t, os.Symlink(realMarker, filepath.Join(installDirectory, updateidentity.InstallationMarkerName)))

	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.PlatformWindows, Architecture: "amd64", ExecutablePath: executable,
	})

	require.NoError(t, err)
	require.Nil(t, probe.Marker)
	require.Equal(t, updateidentity.ReasonWindowsUnverifiedInstall, updateidentity.ResolveInstallation(probe).Reason)
}
