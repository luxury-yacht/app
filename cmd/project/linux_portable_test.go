package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

func TestCreateLinuxPortableArtifactsUsesOneProductionBinaryForInstallerAndUpdater(t *testing.T) {
	root := t.TempDir()
	config := testLinuxPortableConfig(t, root)

	artifacts, err := createLinuxPortableArtifacts(config)

	require.NoError(t, err)
	require.Equal(t, filepath.Join(root, "out", "luxury-yacht-v2.0.0-beta.3-linux-amd64-updater.tar.gz"), artifacts.UpdaterArchive)
	require.Equal(t, filepath.Join(root, "out", "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable.tar.gz"), artifacts.InstallerArchive)

	updaterEntries := readTarGzEntries(t, artifacts.UpdaterArchive)
	require.Equal(t, []string{"luxury-yacht"}, tarEntryNames(updaterEntries))
	require.Equal(t, []byte("production linux binary"), updaterEntries[0].contents)
	require.Equal(t, int64(0o755), updaterEntries[0].header.Mode)

	installerEntries := readTarGzEntries(t, artifacts.InstallerArchive)
	installerRoot := "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable"
	require.Equal(t, []string{
		installerRoot + "/LICENSE",
		installerRoot + "/README.txt",
		installerRoot + "/install.sh",
		installerRoot + "/luxury-yacht",
		installerRoot + "/luxury-yacht.desktop",
		installerRoot + "/luxury-yacht.install.json",
		installerRoot + "/luxury-yacht.png",
	}, tarEntryNames(installerEntries))
	require.Equal(t, []byte("production linux binary"), tarEntry(t, installerEntries, installerRoot+"/luxury-yacht").contents)
	require.Equal(t, int64(0o755), tarEntry(t, installerEntries, installerRoot+"/luxury-yacht").header.Mode)
	require.Equal(t, int64(0o755), tarEntry(t, installerEntries, installerRoot+"/install.sh").header.Mode)
	require.Contains(t, string(tarEntry(t, installerEntries, installerRoot+"/install.sh").contents), `portable_architecture='amd64'`)
	require.NotContains(t, string(tarEntry(t, installerEntries, installerRoot+"/install.sh").contents), portableArchitecturePlaceholder)
	for _, name := range []string{"README.txt", "install.sh", "luxury-yacht.install.json"} {
		require.NotContains(t, string(tarEntry(t, installerEntries, installerRoot+"/"+name).contents), "__APP_")
	}
	desktop := string(tarEntry(t, installerEntries, installerRoot+"/luxury-yacht.desktop").contents)
	require.NotContains(t, desktop, "__APP_")
	require.Contains(t, desktop, portableExecutablePlaceholder)
}

func TestCreateLinuxPortableArtifactsIsDeterministic(t *testing.T) {
	root := t.TempDir()
	firstConfig := testLinuxPortableConfig(t, root)
	firstConfig.OutputDirectory = filepath.Join(root, "first")
	secondConfig := firstConfig
	secondConfig.OutputDirectory = filepath.Join(root, "second")

	first, err := createLinuxPortableArtifacts(firstConfig)
	require.NoError(t, err)
	second, err := createLinuxPortableArtifacts(secondConfig)
	require.NoError(t, err)

	require.Equal(t, readTestFileBytes(t, first.UpdaterArchive), readTestFileBytes(t, second.UpdaterArchive))
	require.Equal(t, readTestFileBytes(t, first.InstallerArchive), readTestFileBytes(t, second.InstallerArchive))
}

func TestPortableInstallerCreatesAndRemovesAnEligibleUserInstallation(t *testing.T) {
	if testing.Short() {
		t.Skip("executes the portable installer")
	}
	root := t.TempDir()
	config := testLinuxPortableConfig(t, root)
	artifacts, err := createLinuxPortableArtifacts(config)
	require.NoError(t, err)

	extractRoot := filepath.Join(root, "extract")
	require.NoError(t, extractRegularTarGz(artifacts.InstallerArchive, extractRoot))
	installerRoot := filepath.Join(extractRoot, "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable")
	dataHome := filepath.Join(root, "xdg data")
	installCommand := exec.Command("sh", filepath.Join(installerRoot, "install.sh"))
	installCommand.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	output, err := installCommand.CombinedOutput()
	require.NoError(t, err, string(output))

	installationRoot := filepath.Join(dataHome, "luxury-yacht")
	executable := filepath.Join(installationRoot, "luxury-yacht")
	markerPath := filepath.Join(installationRoot, updateidentity.InstallationMarkerName)
	require.Equal(t, []byte("production linux binary"), readTestFileBytes(t, executable))
	require.Equal(t, readTestFileBytes(t, config.MarkerPath), readTestFileBytes(t, markerPath))
	require.NoFileExists(t, filepath.Join(installationRoot, "installation-marker.expected.json"))
	require.Contains(t, readTestFile(t, filepath.Join(dataHome, "applications", "org.wails.luxury_yacht.desktop")), `Exec="`+executable+`" %u`)
	require.Equal(t, []byte("icon"), readTestFileBytes(t, filepath.Join(dataHome, "icons", "hicolor", "128x128", "apps", "org.wails.luxury_yacht.png")))
	require.Contains(t, readTestFile(t, filepath.Join(dataHome, "applications", "org.wails.luxury_yacht.desktop")), "Icon=org.wails.luxury_yacht\n")
	require.NoFileExists(t, filepath.Join(dataHome, "applications", "luxury-yacht.desktop"))

	eligibility := updateidentity.ResolveInstallation(updateidentity.InstallationProbe{
		Platform: updateidentity.PlatformLinux, Architecture: "amd64", TargetPath: executable,
		ParentWritable: true,
		Marker:         &updateidentity.MarkerCandidate{Path: markerPath, Data: readTestFileBytes(t, markerPath)},
	})
	require.True(t, eligibility.CanCheck)
	require.True(t, eligibility.CanInstall)
	require.Equal(t, updateidentity.DistributionLinuxPortable, eligibility.Distribution)

	// The updater replaces only the executable; portable identity and desktop
	// integration must survive that swap.
	require.NoError(t, os.WriteFile(executable, []byte("updated binary"), 0o755))
	require.Equal(t, readTestFileBytes(t, config.MarkerPath), readTestFileBytes(t, markerPath))
	require.FileExists(t, filepath.Join(dataHome, "applications", "org.wails.luxury_yacht.desktop"))
	require.FileExists(t, filepath.Join(dataHome, "icons", "hicolor", "128x128", "apps", "org.wails.luxury_yacht.png"))
	updaterTempRoot := createOwnedUpdaterTempRoot(t, dataHome)
	require.NoError(t, os.Mkdir(filepath.Join(updaterTempRoot, "wails-update-stale"), 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(updaterTempRoot, "wails-update-123.log"), []byte("stale helper log"), 0o600))
	lookalikeTempRoot := filepath.Join(dataHome, "luxury-yacht-update-unrelated")
	require.NoError(t, os.Mkdir(lookalikeTempRoot, 0o700))
	require.NoError(t, os.WriteFile(
		filepath.Join(lookalikeTempRoot, ".luxury-yacht-temp-root.json"),
		readTestFileBytes(t, filepath.Join(updaterTempRoot, ".luxury-yacht-temp-root.json")),
		0o600,
	))
	require.NoError(t, os.WriteFile(filepath.Join(lookalikeTempRoot, "keep-me"), []byte("unowned"), 0o600))

	uninstallCommand := exec.Command("sh", filepath.Join(installationRoot, "manage-installation"), "uninstall")
	uninstallCommand.Env = append(os.Environ(), "XDG_DATA_HOME="+filepath.Join(root, "different data home"))
	output, err = uninstallCommand.CombinedOutput()
	require.NoError(t, err, string(output))
	require.NoFileExists(t, executable)
	require.NoFileExists(t, markerPath)
	require.NoFileExists(t, filepath.Join(dataHome, "applications", "org.wails.luxury_yacht.desktop"))
	require.NoFileExists(t, filepath.Join(dataHome, "icons", "hicolor", "128x128", "apps", "org.wails.luxury_yacht.png"))
	require.NoDirExists(t, updaterTempRoot)
	require.FileExists(t, filepath.Join(lookalikeTempRoot, "keep-me"))
}

func TestPortableInstallerMigratesOnlyItsOwnLegacyDesktopEntry(t *testing.T) {
	for _, owned := range []bool{true, false} {
		t.Run(fmt.Sprintf("owned=%t", owned), func(t *testing.T) {
			root := t.TempDir()
			config := testLinuxPortableConfig(t, root)
			artifacts, err := createLinuxPortableArtifacts(config)
			require.NoError(t, err)
			extractRoot := filepath.Join(root, "extract")
			require.NoError(t, extractRegularTarGz(artifacts.InstallerArchive, extractRoot))
			installer := filepath.Join(extractRoot, "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable", "install.sh")
			dataHome := filepath.Join(root, "xdg data")
			install := func() {
				command := exec.Command("sh", installer)
				command.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
				output, err := command.CombinedOutput()
				require.NoError(t, err, string(output))
			}
			install()
			desktopPath := filepath.Join(dataHome, "applications", "org.wails.luxury_yacht.desktop")
			iconPath := filepath.Join(dataHome, "icons", "hicolor", "128x128", "apps", "org.wails.luxury_yacht.png")
			legacyDesktopPath := filepath.Join(filepath.Dir(desktopPath), "luxury-yacht.desktop")
			legacyIconPath := filepath.Join(filepath.Dir(iconPath), "luxury-yacht.png")
			legacyDesktop := strings.ReplaceAll(readTestFile(t, desktopPath), "Icon=org.wails.luxury_yacht", "Icon=luxury-yacht")
			if !owned {
				legacyDesktop = strings.ReplaceAll(legacyDesktop, filepath.Join(dataHome, "luxury-yacht", "luxury-yacht"), "/other/luxury-yacht")
			}
			require.NoError(t, os.WriteFile(legacyDesktopPath, []byte(legacyDesktop), 0o644))
			require.NoError(t, os.Rename(iconPath, legacyIconPath))
			require.NoError(t, os.Remove(desktopPath))

			install()
			install() // Reinstalling must not recreate a duplicate launcher.
			require.Contains(t, readTestFile(t, desktopPath), "Icon=org.wails.luxury_yacht\n")
			require.Equal(t, []byte("icon"), readTestFileBytes(t, iconPath))
			if owned {
				require.NoFileExists(t, legacyDesktopPath)
				require.NoFileExists(t, legacyIconPath)
			} else {
				require.Equal(t, legacyDesktop, readTestFile(t, legacyDesktopPath))
				require.Equal(t, []byte("icon"), readTestFileBytes(t, legacyIconPath))
			}
		})
	}
}

func TestPortableUninstallerPreservesUpdaterTempRootWithUnknownContents(t *testing.T) {
	if testing.Short() {
		t.Skip("executes the portable installer")
	}
	root := t.TempDir()
	config := testLinuxPortableConfig(t, root)
	artifacts, err := createLinuxPortableArtifacts(config)
	require.NoError(t, err)

	extractRoot := filepath.Join(root, "extract")
	require.NoError(t, extractRegularTarGz(artifacts.InstallerArchive, extractRoot))
	installerRoot := filepath.Join(extractRoot, "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable")
	dataHome := filepath.Join(root, "xdg-data")
	installCommand := exec.Command("sh", filepath.Join(installerRoot, "install.sh"))
	installCommand.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	output, err := installCommand.CombinedOutput()
	require.NoError(t, err, string(output))

	updaterTempRoot := createOwnedUpdaterTempRoot(t, dataHome)
	unknownPath := filepath.Join(updaterTempRoot, "user-notes.txt")
	require.NoError(t, os.WriteFile(unknownPath, []byte("preserve"), 0o600))
	installationRoot := filepath.Join(dataHome, "luxury-yacht")
	uninstallCommand := exec.Command("sh", filepath.Join(installationRoot, "manage-installation"), "uninstall")
	output, err = uninstallCommand.CombinedOutput()

	require.NoError(t, err, string(output))
	require.NoFileExists(t, filepath.Join(installationRoot, "luxury-yacht"))
	require.Equal(t, []byte("preserve"), readTestFileBytes(t, unknownPath))
}

func TestPortableInstallerUpgradeValidatesInstalledMarker(t *testing.T) {
	if testing.Short() {
		t.Skip("executes the portable installer")
	}
	root := t.TempDir()
	config := testLinuxPortableConfig(t, root)
	artifacts, err := createLinuxPortableArtifacts(config)
	require.NoError(t, err)

	extractRoot := filepath.Join(root, "extract")
	require.NoError(t, extractRegularTarGz(artifacts.InstallerArchive, extractRoot))
	installerRoot := filepath.Join(extractRoot, "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable")
	installer := filepath.Join(installerRoot, "install.sh")
	dataHome := filepath.Join(root, "xdg-data")
	installCommand := exec.Command("sh", installer)
	installCommand.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	output, err := installCommand.CombinedOutput()
	require.NoError(t, err, string(output))

	installationRoot := filepath.Join(dataHome, "luxury-yacht")
	markerPath := filepath.Join(installationRoot, updateidentity.InstallationMarkerName)
	reformattedMarker := []byte("{\n  \"schemaVersion\": 1,\n  \"productIdentifier\": \"" + updateidentity.ProductIdentifier + "\",\n  \"distribution\": \"portable\",\n  \"scope\": \"user\"\n}\n")
	require.NoError(t, os.WriteFile(markerPath, reformattedMarker, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(installerRoot, "luxury-yacht"), []byte("upgraded binary"), 0o755))

	upgradeCommand := exec.Command("sh", installer)
	upgradeCommand.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	output, err = upgradeCommand.CombinedOutput()

	require.NoError(t, err, string(output))
	require.Equal(t, []byte("upgraded binary"), readTestFileBytes(t, filepath.Join(installationRoot, "luxury-yacht")))

	invalidMarker := []byte(`{"schemaVersion":1,"productIdentifier":"other-product","distribution":"portable","scope":"user"}`)
	require.NoError(t, os.WriteFile(markerPath, invalidMarker, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(installerRoot, "luxury-yacht"), []byte("must not install"), 0o755))
	rejectedUpgrade := exec.Command("sh", installer)
	rejectedUpgrade.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	output, err = rejectedUpgrade.CombinedOutput()

	require.Error(t, err)
	require.Contains(t, string(output), "existing installation is not a verified Luxury Yacht portable install")
	require.Equal(t, []byte("upgraded binary"), readTestFileBytes(t, filepath.Join(installationRoot, "luxury-yacht")))
}

func TestPortableInstallerRefusesToClaimAnUnmarkedExistingTarget(t *testing.T) {
	if testing.Short() {
		t.Skip("executes the portable installer")
	}
	root := t.TempDir()
	config := testLinuxPortableConfig(t, root)
	artifacts, err := createLinuxPortableArtifacts(config)
	require.NoError(t, err)

	extractRoot := filepath.Join(root, "extract")
	require.NoError(t, extractRegularTarGz(artifacts.InstallerArchive, extractRoot))
	dataHome := filepath.Join(root, "xdg-data")
	installationRoot := filepath.Join(dataHome, "luxury-yacht")
	require.NoError(t, os.MkdirAll(installationRoot, 0o755))
	executable := filepath.Join(installationRoot, "luxury-yacht")
	require.NoError(t, os.WriteFile(executable, []byte("unmanaged binary"), 0o755))

	installer := filepath.Join(extractRoot, "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable", "install.sh")
	command := exec.Command("sh", installer)
	command.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	output, err := command.CombinedOutput()

	require.Error(t, err)
	require.Contains(t, string(output), "existing installation is not a verified Luxury Yacht portable install")
	require.Equal(t, []byte("unmanaged binary"), readTestFileBytes(t, executable))
}

func TestPortableUninstallerRejectsMatchingButInvalidMarkerCopies(t *testing.T) {
	if testing.Short() {
		t.Skip("executes the portable installer")
	}
	root := t.TempDir()
	config := testLinuxPortableConfig(t, root)
	artifacts, err := createLinuxPortableArtifacts(config)
	require.NoError(t, err)

	extractRoot := filepath.Join(root, "extract")
	require.NoError(t, extractRegularTarGz(artifacts.InstallerArchive, extractRoot))
	installerRoot := filepath.Join(extractRoot, "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable")
	dataHome := filepath.Join(root, "xdg-data")
	installCommand := exec.Command("sh", filepath.Join(installerRoot, "install.sh"))
	installCommand.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	output, err := installCommand.CombinedOutput()
	require.NoError(t, err, string(output))

	installationRoot := filepath.Join(dataHome, "luxury-yacht")
	invalidMarker := []byte(`{"schemaVersion":1,"productIdentifier":"other-product","distribution":"portable","scope":"user"}`)
	require.NoError(t, os.WriteFile(filepath.Join(installationRoot, updateidentity.InstallationMarkerName), invalidMarker, 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(installationRoot, "installation-marker.expected.json"), invalidMarker, 0o644))

	uninstallCommand := exec.Command("sh", filepath.Join(installationRoot, "manage-installation"), "uninstall")
	output, err = uninstallCommand.CombinedOutput()

	require.Error(t, err)
	require.Contains(t, string(output), "portable installation marker is invalid")
	require.FileExists(t, filepath.Join(installationRoot, "luxury-yacht"))
}

func TestPortableInstallerRecoversAnInterruptedMarkerFirstInstall(t *testing.T) {
	if testing.Short() {
		t.Skip("executes the portable installer")
	}
	root := t.TempDir()
	config := testLinuxPortableConfig(t, root)
	artifacts, err := createLinuxPortableArtifacts(config)
	require.NoError(t, err)

	extractRoot := filepath.Join(root, "extract")
	require.NoError(t, extractRegularTarGz(artifacts.InstallerArchive, extractRoot))
	installerRoot := filepath.Join(extractRoot, "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable")
	dataHome := filepath.Join(root, "xdg-data")
	installationRoot := filepath.Join(dataHome, "luxury-yacht")
	require.NoError(t, os.MkdirAll(installationRoot, 0o755))
	marker := readTestFileBytes(t, filepath.Join(installerRoot, updateidentity.InstallationMarkerName))
	require.NoError(t, os.WriteFile(
		filepath.Join(installationRoot, updateidentity.InstallationMarkerName),
		marker,
		0o644,
	))

	command := exec.Command("sh", filepath.Join(installerRoot, "install.sh"))
	command.Env = append(os.Environ(), "XDG_DATA_HOME="+dataHome)
	output, err := command.CombinedOutput()

	require.NoError(t, err, string(output))
	require.Equal(t, []byte("production linux binary"), readTestFileBytes(t, filepath.Join(installationRoot, "luxury-yacht")))
}

func TestCreateLinuxPortableArtifactsRejectsUnsafeInputs(t *testing.T) {
	t.Run("unsupported architecture", func(t *testing.T) {
		config := testLinuxPortableConfig(t, t.TempDir())
		config.Architecture = "386"

		_, err := createLinuxPortableArtifacts(config)

		require.ErrorContains(t, err, "unsupported updater artifact target linux/386")
	})

	t.Run("symlinked binary", func(t *testing.T) {
		root := t.TempDir()
		config := testLinuxPortableConfig(t, root)
		realBinary := config.BinaryPath
		config.BinaryPath = filepath.Join(root, "binary-link")
		require.NoError(t, os.Symlink(realBinary, config.BinaryPath))

		_, err := createLinuxPortableArtifacts(config)

		require.ErrorContains(t, err, "must be a regular non-symlink file")
	})

	t.Run("missing output directory", func(t *testing.T) {
		config := testLinuxPortableConfig(t, t.TempDir())
		config.OutputDirectory = ""

		_, err := createLinuxPortableArtifacts(config)

		require.ErrorContains(t, err, "output directory is required")
	})

	t.Run("missing desktop placeholder", func(t *testing.T) {
		root := t.TempDir()
		config := testLinuxPortableConfig(t, root)
		config.DesktopPath = filepath.Join(root, "desktop-without-executable")
		require.NoError(t, os.WriteFile(config.DesktopPath, []byte("[Desktop Entry]\n"), 0o644))

		_, err := createLinuxPortableArtifacts(config)

		require.ErrorContains(t, err, "must contain exactly one")
	})

	t.Run("invalid marker", func(t *testing.T) {
		root := t.TempDir()
		config := testLinuxPortableConfig(t, root)
		config.MarkerPath = filepath.Join(root, "invalid-marker.json")
		require.NoError(t, os.WriteFile(config.MarkerPath, []byte(`{"schemaVersion":1}`), 0o644))

		_, err := createLinuxPortableArtifacts(config)

		require.ErrorContains(t, err, "does not satisfy runtime installation identity")
	})

	t.Run("blocked output directory", func(t *testing.T) {
		root := t.TempDir()
		config := testLinuxPortableConfig(t, root)
		config.OutputDirectory = filepath.Join(root, "blocked")
		require.NoError(t, os.WriteFile(config.OutputDirectory, []byte("not a directory"), 0o644))

		_, err := createLinuxPortableArtifacts(config)

		require.ErrorContains(t, err, "create Linux portable artifact directory")
	})
}

func TestRunCreateLinuxPortableArtifactsUsesConfiguredProject(t *testing.T) {
	root := t.TempDir()
	write := func(name, contents string, mode os.FileMode) {
		path := filepath.Join(root, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, []byte(contents), mode))
	}
	write("build/config.yml", `info:
  productName: Luxury Yacht
  productIdentifier: app.luxury-yacht.desktop
  description: Test app
  version: v2.0.0-beta.3
`, 0o644)
	write("bin/luxury-yacht", "binary", 0o755)
	write("build/appicon.png", "icon", 0o644)
	write("build/linux/portable/desktop", "Name=__APP_NAME__\nExec=__PORTABLE_EXECUTABLE__ %u\n", 0o644)
	write("build/linux/portable/install.sh", "#!/bin/sh\nportable_architecture='__PORTABLE_ARCHITECTURE__'\n", 0o644)
	write("build/linux/portable/install.json", `{"schemaVersion":1,"productIdentifier":"__APP_IDENTIFIER__","distribution":"portable","scope":"user"}`, 0o644)
	write("build/linux/portable/README.txt", "__APP_NAME__ __APP_VERSION__", 0o644)
	write("LICENSE", "license", 0o644)
	t.Chdir(root)
	t.Setenv("GOARCH", "amd64")

	require.NoError(t, runCreateLinuxPortableArtifacts())
	require.FileExists(t, filepath.Join(root, "bin", "luxury-yacht-v2.0.0-beta.3-linux-amd64-updater.tar.gz"))
	require.FileExists(t, filepath.Join(root, "bin", "luxury-yacht-v2.0.0-beta.3-linux-amd64-portable.tar.gz"))
}

func TestPortableArchiveWritersRejectInvalidOrChangedPayloads(t *testing.T) {
	t.Run("missing archive parent", func(t *testing.T) {
		err := writePortableTarGz(filepath.Join(t.TempDir(), "missing", "archive.tar.gz"), nil)
		require.ErrorContains(t, err, "create temporary Linux portable archive")
	})

	t.Run("unsafe entry name", func(t *testing.T) {
		err := writePortableTarGz(filepath.Join(t.TempDir(), "archive.tar.gz"), []portableArchiveEntry{{
			contents: []byte("payload"), mode: 0o755, name: "../payload",
		}})
		require.ErrorContains(t, err, "unsafe archive entry name")
	})

	t.Run("missing entry source", func(t *testing.T) {
		err := writePortableTarGz(filepath.Join(t.TempDir(), "archive.tar.gz"), []portableArchiveEntry{{
			mode: 0o755, name: "payload", source: filepath.Join(t.TempDir(), "missing"),
		}})
		require.ErrorContains(t, err, "open archive source")
	})

	t.Run("archive output collision", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "archive.tar.gz")
		require.NoError(t, os.Mkdir(path, 0o755))
		err := writePortableTarGz(path, []portableArchiveEntry{{
			contents: []byte("payload"), mode: 0o755, name: "payload",
		}})
		require.ErrorContains(t, err, "publish Linux portable archive")
	})

	t.Run("directory entry source", func(t *testing.T) {
		err := writePortableTarGz(filepath.Join(t.TempDir(), "archive.tar.gz"), []portableArchiveEntry{{
			mode: 0o755, name: "payload", source: t.TempDir(),
		}})
		require.ErrorContains(t, err, "write archive entry")
	})

	t.Run("empty updater archive", func(t *testing.T) {
		root := t.TempDir()
		archive := filepath.Join(root, "archive.tar.gz")
		require.NoError(t, writePortableTarGz(archive, nil))
		binary := filepath.Join(root, "luxury-yacht")
		require.NoError(t, os.WriteFile(binary, []byte("binary"), 0o755))
		err := validateLinuxUpdaterArchive(archive, binary, "luxury-yacht")
		require.ErrorContains(t, err, "read Linux updater archive")
	})

	t.Run("wrong updater payload", func(t *testing.T) {
		root := t.TempDir()
		binary := filepath.Join(root, "luxury-yacht")
		require.NoError(t, os.WriteFile(binary, []byte("expected"), 0o755))
		archive := filepath.Join(root, "archive.tar.gz")
		require.NoError(t, writePortableTarGz(archive, []portableArchiveEntry{{
			contents: []byte("different"), mode: 0o755, name: "luxury-yacht",
		}}))
		err := validateLinuxUpdaterArchive(archive, binary, "luxury-yacht")
		require.ErrorContains(t, err, "does not match the production binary")
	})

	t.Run("multiple updater entries", func(t *testing.T) {
		root := t.TempDir()
		binary := filepath.Join(root, "luxury-yacht")
		require.NoError(t, os.WriteFile(binary, []byte("expected"), 0o755))
		archive := filepath.Join(root, "archive.tar.gz")
		require.NoError(t, writePortableTarGz(archive, []portableArchiveEntry{
			{contents: []byte("expected"), mode: 0o755, name: "luxury-yacht"},
			{contents: []byte("sibling"), mode: 0o644, name: "README"},
		}))
		err := validateLinuxUpdaterArchive(archive, binary, "luxury-yacht")
		require.ErrorContains(t, err, "exactly one entry")
	})

	t.Run("missing updater archive", func(t *testing.T) {
		err := validateLinuxUpdaterArchive(
			filepath.Join(t.TempDir(), "missing.tar.gz"),
			filepath.Join(t.TempDir(), "binary"),
			"luxury-yacht",
		)
		require.ErrorContains(t, err, "open Linux updater archive")
	})

	t.Run("invalid updater gzip", func(t *testing.T) {
		root := t.TempDir()
		archive := filepath.Join(root, "archive.tar.gz")
		require.NoError(t, os.WriteFile(archive, []byte("not gzip"), 0o644))
		err := validateLinuxUpdaterArchive(archive, filepath.Join(root, "binary"), "luxury-yacht")
		require.ErrorContains(t, err, "open Linux updater gzip")
	})

	t.Run("wrong updater entry name", func(t *testing.T) {
		root := t.TempDir()
		archive := filepath.Join(root, "archive.tar.gz")
		require.NoError(t, writePortableTarGz(archive, []portableArchiveEntry{{
			contents: []byte("binary"), mode: 0o755, name: "other-app",
		}}))
		err := validateLinuxUpdaterArchive(archive, filepath.Join(root, "binary"), "luxury-yacht")
		require.ErrorContains(t, err, "must contain one executable regular file")
	})

	t.Run("missing source binary after valid archive", func(t *testing.T) {
		root := t.TempDir()
		archive := filepath.Join(root, "archive.tar.gz")
		require.NoError(t, writePortableTarGz(archive, []portableArchiveEntry{{
			contents: []byte("binary"), mode: 0o755, name: "luxury-yacht",
		}}))
		err := validateLinuxUpdaterArchive(archive, filepath.Join(root, "missing-binary"), "luxury-yacht")
		require.ErrorContains(t, err, "open Linux updater source binary")
	})
}

func TestPortableInputHelpersReportMissingFiles(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing")
	require.ErrorContains(t, validatePortableArtifactInput("binary", missing), "inspect Linux portable binary")

	metadata := testInstallMetadata()
	_, err := renderLinuxPortableInput(missing, metadata, "amd64")
	require.ErrorContains(t, err, "read Linux portable input")
}

type testTarEntry struct {
	header   tar.Header
	contents []byte
}

func testLinuxPortableConfig(t *testing.T, root string) linuxPortableArtifactsConfig {
	t.Helper()
	write := func(name, contents string, mode os.FileMode) string {
		path := filepath.Join(root, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, []byte(contents), mode))
		return path
	}
	metadata := testInstallMetadata()
	metadata.Info.Version = "v2.0.0-beta.3"
	metadata.Info.ProductIdentifier = updateidentity.ProductIdentifier
	metadata.Info.Description = "Test desktop application"
	return linuxPortableArtifactsConfig{
		Architecture:    "amd64",
		BinaryPath:      write("inputs/luxury-yacht", "production linux binary", 0o751),
		DesktopPath:     repositoryPath("build", "linux", "portable", "desktop"),
		IconPath:        write("inputs/luxury-yacht.png", "icon", 0o644),
		InstallerPath:   repositoryPath("build", "linux", "portable", "install.sh"),
		LicensePath:     write("inputs/LICENSE", "license", 0o644),
		MarkerPath:      write("inputs/"+updateidentity.InstallationMarkerName, `{"schemaVersion":1,"productIdentifier":"app.luxury-yacht.desktop","distribution":"portable","scope":"user"}`+"\n", 0o644),
		Metadata:        metadata,
		OutputDirectory: filepath.Join(root, "out"),
		ReadmePath:      repositoryPath("build", "linux", "portable", "README.txt"),
	}
}

func createOwnedUpdaterTempRoot(t *testing.T, dataHome string) string {
	t.Helper()
	currentUser, err := user.Current()
	require.NoError(t, err)
	digest := sha256.Sum256([]byte(currentUser.Uid))
	userIDHash := hex.EncodeToString(digest[:])
	root := filepath.Join(dataHome, "luxury-yacht-update-"+userIDHash[:12])
	require.NoError(t, os.Mkdir(root, 0o700))
	marker := `{"schemaVersion":1,"productIdentifier":"` + updateidentity.ProductIdentifier + `","userIdHash":"` + userIDHash + `"}` + "\n"
	require.NoError(t, os.WriteFile(filepath.Join(root, ".luxury-yacht-temp-root.json"), []byte(marker), 0o600))
	return root
}

func readTarGzEntries(t *testing.T, path string) []testTarEntry {
	t.Helper()
	file, err := os.Open(path)
	require.NoError(t, err)
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	var entries []testTarEntry
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		contents, err := io.ReadAll(tarReader)
		require.NoError(t, err)
		entries = append(entries, testTarEntry{header: *header, contents: contents})
	}
	return entries
}

func tarEntryNames(entries []testTarEntry) []string {
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.header.Name)
	}
	return names
}

func tarEntry(t *testing.T, entries []testTarEntry, name string) testTarEntry {
	t.Helper()
	for _, entry := range entries {
		if entry.header.Name == name {
			return entry
		}
	}
	t.Fatalf("archive entry %q not found in %v", name, tarEntryNames(entries))
	return testTarEntry{}
}

func extractRegularTarGz(path, destination string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if header.Typeflag != tar.TypeReg {
			return &os.PathError{Op: "extract non-regular archive entry", Path: header.Name}
		}
		cleanName := filepath.Clean(header.Name)
		if filepath.IsAbs(cleanName) || cleanName == ".." || strings.HasPrefix(cleanName, ".."+string(os.PathSeparator)) {
			return &os.PathError{Op: "extract unsafe archive entry", Path: header.Name}
		}
		target := filepath.Join(destination, cleanName)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		var contents bytes.Buffer
		if _, err := io.Copy(&contents, reader); err != nil {
			return err
		}
		if err := os.WriteFile(target, contents.Bytes(), os.FileMode(header.Mode)); err != nil {
			return err
		}
	}
}

func readTestFileBytes(t *testing.T, path string) []byte {
	t.Helper()
	contents, err := os.ReadFile(path)
	require.NoError(t, err)
	return contents
}
