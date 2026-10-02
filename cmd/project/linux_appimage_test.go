package main

import (
	"bytes"
	"encoding/binary"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

func TestCreateLinuxAppImageShipsOnlyTheAppAndUsesHostLibraries(t *testing.T) {
	requireSquashFSTools(t)
	root := t.TempDir()
	config := testLinuxAppImageConfig(t, root)

	artifact, err := createLinuxAppImage(config)

	require.NoError(t, err)
	require.Equal(t, filepath.Join(root, "out", "luxury-yacht-v2.0.0-beta.3-linux-x86_64.AppImage"), artifact)
	info, err := os.Stat(artifact)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o755), info.Mode().Perm())
	runtimeBytes := readTestFileBytes(t, config.RuntimePath)
	require.True(t, bytes.HasPrefix(readTestFileBytes(t, artifact), runtimeBytes), "AppImage must start with the pinned runtime")

	appDir := extractTestAppImage(t, artifact, len(runtimeBytes))
	// Unprivileged users run the image through FUSE, so every directory must be
	// traversable and nothing beyond the app itself may be bundled.
	require.Equal(t, map[string]os.FileMode{
		".":                                 os.ModeDir | 0o755,
		".DirIcon":                          0o644,
		"AppRun":                            0o755,
		"org.wails.luxury_yacht.desktop":    0o644,
		"org.wails.luxury_yacht.png":        0o644,
		"usr":                               os.ModeDir | 0o755,
		"usr/bin":                           os.ModeDir | 0o755,
		"usr/bin/luxury-yacht":              0o755,
		"usr/bin/luxury-yacht.install.json": 0o644,
	}, appImageEntryModes(t, appDir))
	require.Equal(t, readTestFileBytes(t, config.BinaryPath), readTestFileBytes(t, filepath.Join(appDir, "usr", "bin", "luxury-yacht")))

	// The marker beside the executable is the runtime's AppImage identity.
	probe, err := updateidentity.CollectInstallationProbe(updateidentity.ProbeOptions{
		Platform: updateidentity.PlatformLinux, Architecture: "amd64",
		ExecutablePath:    filepath.Join(appDir, "usr", "bin", "luxury-yacht"),
		PackageMarkerPath: filepath.Join(root, "no-package-marker.json"),
	})
	require.NoError(t, err)
	require.Equal(t, updateidentity.InstallationEligibility{
		CanCheck: true, Distribution: updateidentity.DistributionLinuxAppImage,
		Reason:   updateidentity.ReasonLinuxAppImageIneligible,
		Recovery: updateidentity.RecoveryLinuxAppImageDownload,
	}, updateidentity.ResolveInstallation(probe))

	// Desktop integrators launch the binary named by Exec and show the icon
	// named by Icon from the image root.
	desktop := string(readTestFileBytes(t, filepath.Join(appDir, "org.wails.luxury_yacht.desktop")))
	require.Contains(t, desktop, "\nExec=luxury-yacht %u\n")
	require.Contains(t, desktop, "\nIcon=org.wails.luxury_yacht\n")
	for _, name := range []string{"AppRun", "org.wails.luxury_yacht.desktop", "usr/bin/luxury-yacht.install.json"} {
		require.NotContains(t, string(readTestFileBytes(t, filepath.Join(appDir, name))), "__", name)
	}
}

func TestCreateLinuxAppImageIsDeterministic(t *testing.T) {
	requireSquashFSTools(t)
	root := t.TempDir()
	first := testLinuxAppImageConfig(t, root)
	first.OutputDirectory = filepath.Join(root, "first")
	second := first
	second.OutputDirectory = filepath.Join(root, "second")

	firstArtifact, err := createLinuxAppImage(first)
	require.NoError(t, err)
	secondArtifact, err := createLinuxAppImage(second)
	require.NoError(t, err)

	require.Equal(t, readTestFileBytes(t, firstArtifact), readTestFileBytes(t, secondArtifact))
}

func TestLinuxAppImageAppRunPassesTheLaunchEnvironmentThrough(t *testing.T) {
	requireSquashFSTools(t)
	if _, err := exec.LookPath("getconf"); err != nil {
		t.Skip("AppRun checks libraries with the glibc loader")
	}
	machine, ok := linuxELFMachines[runtime.GOARCH]
	if !ok {
		t.Skipf("no AppImage runtime for %s", runtime.GOARCH)
	}
	root := t.TempDir()
	config := testLinuxAppImageConfig(t, root)
	config.Architecture = runtime.GOARCH
	require.NoError(t, os.WriteFile(config.RuntimePath, testAppImageRuntime(machine), 0o755))
	// A real dynamically linked shell stands in for the app so the loader check
	// passes and the "app" can report the environment and arguments it received.
	shell, err := exec.LookPath("sh")
	require.NoError(t, err)
	shellBytes, err := os.ReadFile(shell)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(config.BinaryPath, shellBytes, 0o755))
	artifact, err := createLinuxAppImage(config)
	require.NoError(t, err)
	appDir := extractTestAppImage(t, artifact, len(readTestFileBytes(t, config.RuntimePath)))

	// Credential plugins inherit the app's environment, so AppRun must not add
	// or override variables such as PYTHONHOME or LD_LIBRARY_PATH.
	launchEnvironment := []string{
		"HOME=" + root,
		"PATH=" + os.Getenv("PATH"),
		"PYTHONHOME=/opt/host-python",
		"LD_LIBRARY_PATH=/opt/host-libraries",
	}
	command := exec.Command(filepath.Join(appDir, "AppRun"), "-c", `printf '%s\n' "$@"; env`, "app", "two words", "--flag")
	command.Env = launchEnvironment
	output, err := command.CombinedOutput()
	require.NoError(t, err, string(output))

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	require.Equal(t, []string{"two words", "--flag"}, lines[:2])
	received := slices.DeleteFunc(lines[2:], func(line string) bool {
		// The shell standing in for the app maintains these itself.
		return strings.HasPrefix(line, "PWD=") || strings.HasPrefix(line, "SHLVL=") || strings.HasPrefix(line, "_=")
	})
	slices.Sort(received)
	slices.Sort(launchEnvironment)
	require.Equal(t, launchEnvironment, received)
}

func TestCreateLinuxAppImageRejectsInvalidInputs(t *testing.T) {
	t.Run("runtime is not an AppImage runtime", func(t *testing.T) {
		root := t.TempDir()
		config := testLinuxAppImageConfig(t, root)
		require.NoError(t, os.WriteFile(config.RuntimePath, []byte("\x7fELF not an appimage runtime header"), 0o755))

		_, err := createLinuxAppImage(config)

		require.ErrorContains(t, err, "is not an AppImage type 2 runtime")
	})

	t.Run("runtime for another architecture", func(t *testing.T) {
		root := t.TempDir()
		config := testLinuxAppImageConfig(t, root)
		config.Architecture = "arm64"
		require.NoError(t, os.WriteFile(config.BinaryPath, testELFBinary(elfMachineAArch64), 0o755))

		_, err := createLinuxAppImage(config)

		require.ErrorContains(t, err, "is not an arm64 AppImage runtime")
	})

	t.Run("binary for another architecture", func(t *testing.T) {
		root := t.TempDir()
		config := testLinuxAppImageConfig(t, root)
		config.Architecture = "arm64"
		require.NoError(t, os.WriteFile(config.RuntimePath, testAppImageRuntime(elfMachineAArch64), 0o755))

		_, err := createLinuxAppImage(config)

		require.ErrorContains(t, err, "is not an arm64 Linux executable")
	})

	t.Run("marker without AppImage identity", func(t *testing.T) {
		root := t.TempDir()
		config := testLinuxAppImageConfig(t, root)
		config.MarkerPath = filepath.Join(root, "portable-marker.json")
		require.NoError(t, os.WriteFile(config.MarkerPath, []byte(`{"schemaVersion":1,"productIdentifier":"__APP_IDENTIFIER__","distribution":"portable","scope":"user"}`), 0o644))

		_, err := createLinuxAppImage(config)

		require.ErrorContains(t, err, "does not satisfy runtime installation identity")
	})
}

func TestCreateLinuxAppImageLeavesNoPartialArtifactWhenSquashFSFails(t *testing.T) {
	requireSquashFSTools(t)
	root := t.TempDir()
	config := testLinuxAppImageConfig(t, root)
	tools := filepath.Join(root, "tools")
	require.NoError(t, os.MkdirAll(tools, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(tools, "mksquashfs"), []byte("#!/bin/sh\necho 'disk full' >&2\nexit 1\n"), 0o755))
	t.Setenv("PATH", tools+string(os.PathListSeparator)+os.Getenv("PATH"))

	_, err := createLinuxAppImage(config)

	// The release job uploads every AppImage in bin/, so a failed build must not
	// leave a partial image or its staging directory behind.
	require.ErrorContains(t, err, "disk full")
	entries, readErr := os.ReadDir(config.OutputDirectory)
	require.NoError(t, readErr)
	require.Empty(t, entries)
}

func TestRunCreateLinuxAppImageUsesConfiguredProject(t *testing.T) {
	requireSquashFSTools(t)
	root := t.TempDir()
	write := func(name string, contents []byte, mode os.FileMode) string {
		path := filepath.Join(root, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, contents, mode))
		return path
	}
	write("build/config.yml", []byte(`info:
  productName: Luxury Yacht
  productIdentifier: app.luxury-yacht.desktop
  description: Test app
  version: v2.0.0-beta.3
`), 0o644)
	write("bin/luxury-yacht", testELFBinary(elfMachineX86_64), 0o755)
	write("build/appicon.png", []byte("icon"), 0o644)
	write("build/linux/portable/desktop", []byte("Name=__APP_NAME__\nExec=__PORTABLE_EXECUTABLE__ %u\n"), 0o644)
	write("build/linux/appimage/AppRun", []byte("#!/bin/sh\nexec \"$(dirname \"$0\")/usr/bin/__APP_BINARY_NAME__\" \"$@\"\n"), 0o644)
	write("build/linux/appimage/install.json", []byte(`{"schemaVersion":1,"productIdentifier":"__APP_IDENTIFIER__","distribution":"appimage","scope":"user"}`), 0o644)
	runtimePath := write("cache/runtime-amd64", testAppImageRuntime(elfMachineX86_64), 0o755)
	t.Chdir(root)
	t.Setenv("GOARCH", "amd64")
	t.Setenv("APPIMAGE_RUNTIME", runtimePath)

	require.NoError(t, runCreateLinuxAppImage())
	require.FileExists(t, filepath.Join(root, "bin", "luxury-yacht-v2.0.0-beta.3-linux-x86_64.AppImage"))
}

func testLinuxAppImageConfig(t *testing.T, root string) linuxAppImageConfig {
	t.Helper()
	write := func(name string, contents []byte, mode os.FileMode) string {
		path := filepath.Join(root, name)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, contents, mode))
		return path
	}
	metadata := testInstallMetadata()
	metadata.Info.Version = "v2.0.0-beta.3"
	metadata.Info.ProductIdentifier = updateidentity.ProductIdentifier
	metadata.Info.Description = "Test desktop application"
	return linuxAppImageConfig{
		AppRunPath:      repositoryPath("build", "linux", "appimage", "AppRun"),
		Architecture:    "amd64",
		BinaryPath:      write("inputs/luxury-yacht", testELFBinary(elfMachineX86_64), 0o751),
		DesktopPath:     repositoryPath("build", "linux", "portable", "desktop"),
		IconPath:        write("inputs/luxury-yacht.png", []byte("icon"), 0o600),
		MarkerPath:      repositoryPath("build", "linux", "appimage", "install.json"),
		Metadata:        metadata,
		OutputDirectory: filepath.Join(root, "out"),
		RuntimePath:     write("inputs/runtime", testAppImageRuntime(elfMachineX86_64), 0o755),
	}
}

// testELFBinary returns an ELF header for the machine followed by a body; the
// builder copies the binary verbatim and only inspects its architecture.
func testELFBinary(machine uint16) []byte {
	header := make([]byte, 64)
	copy(header, "\x7fELF\x02\x01\x01")
	binary.LittleEndian.PutUint16(header[18:], machine)
	return append(header, []byte("production linux binary")...)
}

// testAppImageRuntime returns the identifying header of an AppImage type 2
// runtime; the builder only prepends it, so the body is irrelevant here.
func testAppImageRuntime(machine uint16) []byte {
	header := make([]byte, 64)
	copy(header, "\x7fELF\x02\x01\x01")
	copy(header[8:], "AI\x02")
	binary.LittleEndian.PutUint16(header[18:], machine)
	return append(header, []byte("runtime body")...)
}

func requireSquashFSTools(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("AppImages are built on Linux with squashfs-tools")
	}
	for _, tool := range []string{"mksquashfs", "unsquashfs"} {
		_, err := exec.LookPath(tool)
		require.NoError(t, err, "install squashfs-tools to build AppImages")
	}
}

func extractTestAppImage(t *testing.T, artifact string, runtimeSize int) string {
	t.Helper()
	appDir := filepath.Join(t.TempDir(), "squashfs-root")
	output, err := exec.Command("unsquashfs", "-no-progress", "-offset", strconv.Itoa(runtimeSize), "-dest", appDir, artifact).CombinedOutput()
	require.NoError(t, err, string(output))
	return appDir
}

func appImageEntryModes(t *testing.T, appDir string) map[string]os.FileMode {
	t.Helper()
	modes := map[string]os.FileMode{}
	require.NoError(t, filepath.WalkDir(appDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(appDir, path)
		if err != nil {
			return err
		}
		modes[filepath.ToSlash(relative)] = info.Mode() & (os.ModeDir | os.ModeSymlink | os.ModePerm)
		return nil
	}))
	return modes
}
