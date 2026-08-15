package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestReadProjectMetadataFromWailsV3BuildConfig(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.yml")
	config := `version: '3'
info:
  companyName: Test Company
  productName: Test App
  productIdentifier: app.test.desktop
  description: Test description
  copyright: Copyright Test
  comments: Test comments
  version: "v2.0.0-beta.3"
luxuryYacht:
  betaExpiryDays: 45
`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	metadata, err := readProjectMetadata(configPath)
	if err != nil {
		t.Fatalf("readProjectMetadata: %v", err)
	}
	if metadata.Info.Version != "v2.0.0-beta.3" {
		t.Errorf("Version = %q, want v2.0.0-beta.3", metadata.Info.Version)
	}
	require.Equal(t, "Test Company", metadata.Info.CompanyName)
	require.Equal(t, "Test App", metadata.Info.ProductName)
	require.Equal(t, "app.test.desktop", metadata.Info.ProductIdentifier)
	require.Equal(t, "Test description", metadata.Info.Description)
	require.Equal(t, "Copyright Test", metadata.Info.Copyright)
	require.Equal(t, "Test comments", metadata.Info.Comments)
	if metadata.LuxuryYacht.BetaExpiryDays != 45 {
		t.Errorf("BetaExpiryDays = %d, want 45", metadata.LuxuryYacht.BetaExpiryDays)
	}
}

func TestLoadDotEnvLoadsValuesWithoutOverwritingEnvironment(t *testing.T) {
	t.Setenv("SENTRY_ORG", "exported-org")
	previousDSN, hadPreviousDSN := os.LookupEnv("SENTRY_FRONTEND_DSN")
	require.NoError(t, os.Unsetenv("SENTRY_FRONTEND_DSN"))
	t.Cleanup(func() {
		if hadPreviousDSN {
			require.NoError(t, os.Setenv("SENTRY_FRONTEND_DSN", previousDSN))
			return
		}
		require.NoError(t, os.Unsetenv("SENTRY_FRONTEND_DSN"))
	})

	envPath := filepath.Join(t.TempDir(), ".env")
	require.NoError(t, os.WriteFile(envPath, []byte(
		"SENTRY_ORG=file-org\nSENTRY_FRONTEND_DSN=https://public@example.com/1\n",
	), 0o600))

	require.NoError(t, loadDotEnv(envPath))
	require.Equal(t, "exported-org", os.Getenv("SENTRY_ORG"))
	require.Equal(t, "https://public@example.com/1", os.Getenv("SENTRY_FRONTEND_DSN"))
}

func TestLoadDotEnvAllowsMissingFile(t *testing.T) {
	require.NoError(t, loadDotEnv(filepath.Join(t.TempDir(), ".env")))
}

func TestLoadDotEnvRejectsMalformedFile(t *testing.T) {
	envPath := filepath.Join(t.TempDir(), ".env")
	require.NoError(t, os.WriteFile(
		envPath,
		[]byte("SENTRY_ORG='unterminated\n"),
		0o600,
	))

	require.ErrorContains(t, loadDotEnv(envPath), "load environment from")
}

func TestDeriveProjectFactsUsesOneMetadataSnapshot(t *testing.T) {
	var metadata projectMetadata
	metadata.Info.Version = "1.2.3-beta.4"
	metadata.LuxuryYacht.BetaExpiryDays = 30
	now := time.Date(2026, time.August, 12, 12, 0, 0, 0, time.UTC)

	facts := deriveProjectFacts(metadata, now, " abc123 ")

	require.Equal(t, "1.2.3-beta.4", facts.version)
	require.Equal(t, "abc123", facts.commit)
	require.True(t, facts.isBeta)
	require.Equal(t, "2026-09-11T12:00:00Z", facts.betaExpiry)
}

func TestIsBetaVersionRequiresValidBetaReleaseIdentity(t *testing.T) {
	require.True(t, isBetaVersion("v2.0.0-beta.3"))
	require.False(t, isBetaVersion("v2.0.0"))
	require.False(t, isBetaVersion("alphabetical-beta-build"))
}

func TestProjectBinaryNameUsesConfiguredProductName(t *testing.T) {
	var metadata projectMetadata
	metadata.Info.ProductName = " Luxury Yacht Pro "

	name, err := projectBinaryName(metadata)

	require.NoError(t, err)
	require.Equal(t, "luxury-yacht-pro", name)
}

func TestProjectBinaryNameRejectsMissingProductName(t *testing.T) {
	_, err := projectBinaryName(projectMetadata{})
	require.ErrorContains(t, err, "has no info.productName")
}

func TestProjectProductNamePreservesConfiguredDisplayName(t *testing.T) {
	var metadata projectMetadata
	metadata.Info.ProductName = " Luxury Yacht Pro "

	name, err := projectProductName(metadata)

	require.NoError(t, err)
	require.Equal(t, "Luxury Yacht Pro", name)
}

func TestReleaseArtifactNamePreservesVersionPlatformAndArchitecture(t *testing.T) {
	var metadata projectMetadata
	metadata.Info.ProductName = "Luxury Yacht"
	metadata.Info.Version = "v2.0.0"

	for _, test := range []struct {
		goos   string
		arch   string
		format string
		want   string
	}{
		{goos: "darwin", arch: "arm64", format: "dmg", want: "luxury-yacht-v2.0.0-macos-arm64.dmg"},
		{goos: "darwin", arch: "amd64", format: "dmg", want: "luxury-yacht-v2.0.0-macos-amd64.dmg"},
		{goos: "linux", arch: "amd64", format: "deb", want: "luxury-yacht_v2.0.0_linux_amd64.deb"},
		{goos: "linux", arch: "arm64", format: "deb", want: "luxury-yacht_v2.0.0_linux_arm64.deb"},
		{goos: "linux", arch: "amd64", format: "rpm", want: "luxury-yacht-v2.0.0-linux-x86_64.rpm"},
		{goos: "linux", arch: "arm64", format: "rpm", want: "luxury-yacht-v2.0.0-linux-aarch64.rpm"},
		{goos: "windows", arch: "amd64", format: "exe", want: "luxury-yacht-v2.0.0-windows-amd64-installer.exe"},
		{goos: "windows", arch: "arm64", format: "exe", want: "luxury-yacht-v2.0.0-windows-arm64-installer.exe"},
		{goos: "darwin", arch: "arm64", format: "updater", want: "luxury-yacht-v2.0.0-darwin-arm64.zip"},
		{goos: "windows", arch: "amd64", format: "updater", want: "luxury-yacht-v2.0.0-windows-amd64.exe"},
		{goos: "linux", arch: "arm64", format: "updater", want: "luxury-yacht-v2.0.0-linux-arm64.tar.gz"},
	} {
		t.Run(test.goos+"-"+test.arch+"-"+test.format, func(t *testing.T) {
			name, err := releaseArtifactName(metadata, test.goos, test.arch, test.format)

			require.NoError(t, err)
			require.Equal(t, test.want, name)
		})
	}
}

func TestReleaseArtifactNameRejectsUnsupportedTargets(t *testing.T) {
	var metadata projectMetadata
	metadata.Info.ProductName = "Luxury Yacht"
	metadata.Info.Version = "v2.0.0"

	for _, test := range []struct {
		goos   string
		arch   string
		format string
	}{
		{goos: "darwin", arch: "arm64", format: "zip"},
		{goos: "darwin", arch: "386", format: "dmg"},
		{goos: "linux", arch: "arm64", format: "dmg"},
		{goos: "linux", arch: "ppc64", format: "deb"},
		{goos: "linux", arch: "ppc64", format: "rpm"},
		{goos: "windows", arch: "arm64", format: "zip"},
		{goos: "windows", arch: "386", format: "exe"},
		{goos: "freebsd", arch: "amd64", format: "zip"},
	} {
		t.Run(test.goos+"-"+test.arch+"-"+test.format, func(t *testing.T) {
			_, err := releaseArtifactName(metadata, test.goos, test.arch, test.format)

			require.ErrorContains(t, err, "unsupported release artifact target")
		})
	}
}

func TestUpdaterArtifactNameIsExplicitForEverySupportedTarget(t *testing.T) {
	var metadata projectMetadata
	metadata.Info.ProductName = "Luxury Yacht"
	metadata.Info.Version = "v2.0.0-beta.3"

	for _, test := range []struct {
		goos string
		arch string
		want string
	}{
		{goos: "darwin", arch: "amd64", want: "luxury-yacht-v2.0.0-beta.3-darwin-amd64.zip"},
		{goos: "darwin", arch: "arm64", want: "luxury-yacht-v2.0.0-beta.3-darwin-arm64.zip"},
		{goos: "windows", arch: "amd64", want: "luxury-yacht-v2.0.0-beta.3-windows-amd64.exe"},
		{goos: "windows", arch: "arm64", want: "luxury-yacht-v2.0.0-beta.3-windows-arm64.exe"},
		{goos: "linux", arch: "amd64", want: "luxury-yacht-v2.0.0-beta.3-linux-amd64.tar.gz"},
		{goos: "linux", arch: "arm64", want: "luxury-yacht-v2.0.0-beta.3-linux-arm64.tar.gz"},
	} {
		t.Run(test.goos+"-"+test.arch, func(t *testing.T) {
			name, err := updaterArtifactName(metadata, test.goos, test.arch)

			require.NoError(t, err)
			require.Equal(t, test.want, name)
		})
	}
}

func TestUpdaterArtifactNameRejectsUnsupportedTargets(t *testing.T) {
	var metadata projectMetadata
	metadata.Info.ProductName = "Luxury Yacht"
	metadata.Info.Version = "v2.0.0"

	for _, target := range [][2]string{{"darwin", "386"}, {"windows", "386"}, {"linux", "386"}, {"freebsd", "amd64"}} {
		_, err := updaterArtifactName(metadata, target[0], target[1])

		require.ErrorContains(t, err, "unsupported updater artifact target")
	}
}
