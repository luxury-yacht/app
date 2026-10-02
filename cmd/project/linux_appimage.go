package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/luxury-yacht/app/internal/updateidentity"
)

// ELF machine numbers identify which architecture an executable runs on.
const (
	elfMachineX86_64  uint16 = 62
	elfMachineAArch64 uint16 = 183
)

var linuxELFMachines = map[string]uint16{
	"amd64": elfMachineX86_64,
	"arm64": elfMachineAArch64,
}

type linuxAppImageConfig struct {
	AppRunPath      string
	Architecture    string
	BinaryPath      string
	DesktopPath     string
	IconPath        string
	MarkerPath      string
	Metadata        projectMetadata
	OutputDirectory string
	RuntimePath     string
}

// appImageEntry is one file of the AppDir, named relative to its root.
type appImageEntry struct {
	contents []byte
	mode     os.FileMode
	name     string
	source   string
}

func runCreateLinuxAppImage() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read Linux AppImage metadata: %w", err)
	}
	binaryName, err := projectBinaryName(metadata)
	if err != nil {
		return err
	}
	artifact, err := createLinuxAppImage(linuxAppImageConfig{
		AppRunPath:   filepath.Join("build", "linux", "appimage", "AppRun"),
		Architecture: os.Getenv("GOARCH"),
		BinaryPath:   filepath.Join("bin", binaryName),
		// The AppImage integrates with the desktop like a portable installation.
		DesktopPath:     filepath.Join("build", "linux", "portable", "desktop"),
		IconPath:        filepath.Join("build", "appicon.png"),
		MarkerPath:      filepath.Join("build", "linux", "appimage", "install.json"),
		Metadata:        metadata,
		OutputDirectory: "bin",
		RuntimePath:     os.Getenv("APPIMAGE_RUNTIME"),
	})
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(os.Stdout, "Created %s\n", artifact)
	return err
}

// createLinuxAppImage packages the production binary as an AppImage that uses
// the host's GTK 4 and WebKitGTK 6.0. The image holds only the app, its desktop
// integration, its installation marker, and an AppRun that leaves the
// environment unchanged, so processes the app starts see the host as usual.
func createLinuxAppImage(config linuxAppImageConfig) (string, error) {
	architecture := strings.ToLower(strings.TrimSpace(config.Architecture))
	artifactName, err := releaseArtifactName(config.Metadata, "linux", architecture, "appimage")
	if err != nil {
		return "", err
	}
	runtimeImage, err := readAppImageRuntime(config.RuntimePath, architecture)
	if err != nil {
		return "", err
	}
	entries, err := linuxAppImageEntries(config, architecture)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(config.OutputDirectory) == "" {
		return "", fmt.Errorf("linux AppImage output directory is required")
	}
	outputDirectory := filepath.Clean(config.OutputDirectory)
	if err := os.MkdirAll(outputDirectory, 0o755); err != nil {
		return "", fmt.Errorf("create Linux AppImage directory %s: %w", outputDirectory, err)
	}
	staging, err := os.MkdirTemp(outputDirectory, ".appimage-")
	if err != nil {
		return "", fmt.Errorf("create Linux AppImage staging directory: %w", err)
	}
	defer os.RemoveAll(staging)

	appDir := filepath.Join(staging, "AppDir")
	if err := writeAppImageDir(appDir, entries); err != nil {
		return "", err
	}
	squashfs := filepath.Join(staging, "AppDir.squashfs")
	if err := buildAppImageSquashFS(appDir, squashfs); err != nil {
		return "", err
	}
	artifact := filepath.Join(outputDirectory, artifactName)
	if err := writeAppImage(artifact, runtimeImage, squashfs); err != nil {
		return "", err
	}
	return artifact, nil
}

// readAppImageRuntime reads a type 2 runtime: an ELF executable tagged "AI\x02"
// in its identification padding, whose machine field must match the target.
func readAppImageRuntime(path, architecture string) ([]byte, error) {
	if err := validateLinuxArtifactInput("AppImage", "runtime", path); err != nil {
		return nil, err
	}
	runtimeImage, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read Linux AppImage runtime %s: %w", path, err)
	}
	if len(runtimeImage) < 20 || !bytes.HasPrefix(runtimeImage, []byte("\x7fELF")) || !bytes.Equal(runtimeImage[8:11], []byte("AI\x02")) {
		return nil, fmt.Errorf("%s is not an AppImage type 2 runtime", path)
	}
	if !isELFForArchitecture(runtimeImage, architecture) {
		return nil, fmt.Errorf("%s is not an %s AppImage runtime", path, architecture)
	}
	return runtimeImage, nil
}

// requireExecutableArchitecture keeps a binary built for one architecture from
// being published under another architecture's AppImage name.
func requireExecutableArchitecture(path, architecture string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open Linux AppImage binary %s: %w", path, err)
	}
	defer file.Close()
	header := make([]byte, 20)
	if _, err := io.ReadFull(file, header); err != nil || !isELFForArchitecture(header, architecture) {
		return fmt.Errorf("%s is not an %s Linux executable", path, architecture)
	}
	return nil
}

func isELFForArchitecture(header []byte, architecture string) bool {
	return len(header) >= 20 && bytes.HasPrefix(header, []byte("\x7fELF")) &&
		binary.LittleEndian.Uint16(header[18:20]) == linuxELFMachines[architecture]
}

func linuxAppImageEntries(config linuxAppImageConfig, architecture string) ([]appImageEntry, error) {
	binaryName, err := projectBinaryName(config.Metadata)
	if err != nil {
		return nil, err
	}
	if err := validateInstallLeaf("binary name", binaryName); err != nil {
		return nil, err
	}
	for label, path := range map[string]string{
		"AppRun": config.AppRunPath, "binary": config.BinaryPath, "desktop entry": config.DesktopPath,
		"icon": config.IconPath, "marker": config.MarkerPath,
	} {
		if err := validateLinuxArtifactInput("AppImage", label, path); err != nil {
			return nil, err
		}
	}
	if err := requireExecutableArchitecture(config.BinaryPath, architecture); err != nil {
		return nil, err
	}
	appRun, desktop, marker, err := renderLinuxAppImageTemplates(config, architecture, binaryName)
	if err != nil {
		return nil, err
	}
	// AppImage desktop integration reads the entry and icon from the image root.
	return []appImageEntry{
		{contents: appRun, mode: 0o755, name: "AppRun"},
		{contents: desktop, mode: 0o644, name: portableDesktopID + ".desktop"},
		{mode: 0o644, name: portableDesktopID + ".png", source: config.IconPath},
		{mode: 0o644, name: ".DirIcon", source: config.IconPath},
		{mode: 0o755, name: "usr/bin/" + binaryName, source: config.BinaryPath},
		{contents: marker, mode: 0o644, name: "usr/bin/" + updateidentity.InstallationMarkerName},
	}, nil
}

func renderLinuxAppImageTemplates(config linuxAppImageConfig, architecture, binaryName string) (appRun, desktop, marker []byte, err error) {
	appRun, err = renderLinuxArtifactInput("AppImage", config.AppRunPath, config.Metadata, architecture)
	if err != nil {
		return nil, nil, nil, err
	}
	desktop, err = renderLinuxArtifactInput("AppImage", config.DesktopPath, config.Metadata, architecture)
	if err != nil {
		return nil, nil, nil, err
	}
	if bytes.Count(desktop, []byte(portableExecutablePlaceholder)) != 1 {
		return nil, nil, nil, fmt.Errorf("linux AppImage desktop template must contain exactly one %s placeholder", portableExecutablePlaceholder)
	}
	// Integrators replace Exec with the AppImage path; inside the image it names the binary.
	desktop = bytes.Replace(desktop, []byte(portableExecutablePlaceholder), []byte(binaryName), 1)
	marker, err = renderLinuxArtifactInput("AppImage", config.MarkerPath, config.Metadata, architecture)
	if err != nil {
		return nil, nil, nil, err
	}
	eligibility := resolveRenderedLinuxMarker(marker, binaryName)
	if eligibility.CanInstall || eligibility.Distribution != updateidentity.DistributionLinuxAppImage {
		return nil, nil, nil, fmt.Errorf("rendered Linux AppImage marker does not satisfy runtime installation identity")
	}
	return appRun, desktop, marker, nil
}

func writeAppImageDir(appDir string, entries []appImageEntry) error {
	for _, entry := range entries {
		path := filepath.Join(appDir, filepath.FromSlash(entry.name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("create AppImage directory for %s: %w", entry.name, err)
		}
		if err := writeAppImageEntry(path, entry); err != nil {
			return err
		}
	}
	// Unprivileged users traverse the mounted image, so directory modes are fixed
	// rather than inherited from the umask or the private staging directory.
	return filepath.WalkDir(appDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.IsDir() {
			return err
		}
		return os.Chmod(path, 0o755)
	})
}

func writeAppImageEntry(path string, entry appImageEntry) error {
	destination, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, entry.mode)
	if err != nil {
		return fmt.Errorf("create AppImage entry %s: %w", entry.name, err)
	}
	var reader io.Reader = bytes.NewReader(entry.contents)
	if entry.source != "" {
		source, err := os.Open(entry.source)
		if err != nil {
			_ = destination.Close()
			return fmt.Errorf("open AppImage source %s: %w", entry.source, err)
		}
		defer source.Close()
		reader = source
	}
	if _, err := io.Copy(destination, reader); err != nil {
		_ = destination.Close()
		return fmt.Errorf("write AppImage entry %s: %w", entry.name, err)
	}
	if err := destination.Chmod(entry.mode); err != nil {
		_ = destination.Close()
		return fmt.Errorf("set AppImage entry mode %s: %w", entry.name, err)
	}
	return destination.Close()
}

func buildAppImageSquashFS(appDir, destination string) error {
	// Root ownership and fixed timestamps keep the image reproducible; the pinned
	// runtime reads zstd-compressed images.
	command := exec.Command(
		"mksquashfs", appDir, destination,
		"-noappend", "-root-owned", "-no-xattrs", "-comp", "zstd",
		"-mkfs-time", "0", "-all-time", "0", "-quiet", "-no-progress",
	)
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("build AppImage squashfs with mksquashfs (squashfs-tools): %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

// writeAppImage publishes the runtime immediately followed by the squashfs
// image, which is the whole AppImage type 2 format.
func writeAppImage(path string, runtimeImage []byte, squashfsPath string) (returnErr error) {
	squashfs, err := os.Open(squashfsPath)
	if err != nil {
		return fmt.Errorf("open AppImage squashfs: %w", err)
	}
	defer squashfs.Close()
	temporary, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+"-*")
	if err != nil {
		return fmt.Errorf("create temporary AppImage for %s: %w", path, err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		if returnErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := temporary.Write(runtimeImage); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write AppImage runtime to %s: %w", path, err)
	}
	if _, err := io.Copy(temporary, squashfs); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write AppImage squashfs to %s: %w", path, err)
	}
	if err := temporary.Chmod(0o755); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("set AppImage permissions %s: %w", path, err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close AppImage %s: %w", path, err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("publish AppImage %s: %w", path, err)
	}
	return nil
}
