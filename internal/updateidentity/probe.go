package updateidentity

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/luxury-yacht/app/internal/windowsinstall"
)

const defaultLinuxPackageMarkerPath = "/usr/share/luxury-yacht/install.json"

type ProbeOptions struct {
	Platform          Platform
	Architecture      string
	ExecutablePath    string
	HomeDirectory     string
	PackageMarkerPath string
}

// CollectInstallationProbe gathers the filesystem evidence consumed by
// ResolveInstallation. Missing or invalid marker files are represented as
// absent evidence so they resolve to a typed notification-only state.
func CollectInstallationProbe(options ProbeOptions) (InstallationProbe, error) {
	probe, err := collectBaseProbe(options)
	if err != nil {
		return InstallationProbe{}, err
	}
	switch options.Platform {
	case PlatformDarwin:
		return collectMacProbe(probe, options.HomeDirectory)
	case PlatformWindows:
		marker, err := readMarkerCandidate(filepath.Join(filepath.Dir(probe.TargetPath), InstallationMarkerName))
		if err != nil {
			return InstallationProbe{}, err
		}
		probe.Marker = marker
		probe.WindowsMachineRegistered = windowsinstall.LegacyMachineInstall(probe.TargetPath)
		return probe, nil
	case PlatformLinux:
		return collectLinuxProbe(probe, options.PackageMarkerPath)
	default:
		return probe, nil
	}
}

// CollectLinuxPortableInstallationProbe gathers only the adjacent-marker and
// writability evidence needed to decide where a portable target may stage an
// atomic replacement. It deliberately avoids package-manager subprocesses so
// it is safe to call before Wails dispatches updater helper mode.
func CollectLinuxPortableInstallationProbe(architecture, executablePath string) (InstallationProbe, error) {
	probe, err := collectBaseProbe(ProbeOptions{
		Platform: PlatformLinux, Architecture: architecture, ExecutablePath: executablePath,
	})
	if err != nil {
		return InstallationProbe{}, err
	}
	return collectLinuxPortableEvidence(probe)
}

func collectBaseProbe(options ProbeOptions) (InstallationProbe, error) {
	executablePath := filepath.Clean(strings.TrimSpace(options.ExecutablePath))
	if executablePath == "." || !filepath.IsAbs(executablePath) {
		return InstallationProbe{}, fmt.Errorf("executable path must be absolute: %q", options.ExecutablePath)
	}
	if _, err := os.Stat(executablePath); err != nil {
		return InstallationProbe{}, fmt.Errorf("stat executable target %s: %w", executablePath, err)
	}

	probe := InstallationProbe{
		Platform:     options.Platform,
		Architecture: strings.ToLower(strings.TrimSpace(options.Architecture)),
		TargetPath:   executablePath,
	}
	return probe, nil
}

func collectMacProbe(probe InstallationProbe, homeDirectory string) (InstallationProbe, error) {
	probe.TargetPath = macBundleTarget(probe.TargetPath)
	probe.MacInstalledBundle = isInstalledMacBundle(probe.TargetPath, homeDirectory)
	if !probe.MacInstalledBundle {
		return probe, nil
	}
	readOnly, err := platformVolumeReadOnly(probe.TargetPath)
	if err != nil {
		return InstallationProbe{}, fmt.Errorf("inspect target volume %s: %w", probe.TargetPath, err)
	}
	probe.VolumeReadOnly = readOnly
	if !readOnly {
		probe.ParentWritable = probeWritableParent(filepath.Dir(probe.TargetPath))
	}
	return probe, nil
}

func collectLinuxProbe(probe InstallationProbe, packageMarkerPath string) (InstallationProbe, error) {
	probe, err := collectLinuxPortableEvidence(probe)
	if err != nil {
		return InstallationProbe{}, err
	}
	if packageMarkerPath == "" {
		packageMarkerPath = defaultLinuxPackageMarkerPath
	}
	packageMarker, err := readMarkerCandidate(packageMarkerPath)
	if err != nil {
		return InstallationProbe{}, err
	}
	probe.PackageMarker = packageMarker
	probe.PackageManagedTarget = packageManagerOwns(probe.TargetPath)
	return probe, nil
}

func collectLinuxPortableEvidence(probe InstallationProbe) (InstallationProbe, error) {
	marker, err := readMarkerCandidate(filepath.Join(filepath.Dir(probe.TargetPath), InstallationMarkerName))
	if err != nil {
		return InstallationProbe{}, err
	}
	probe.Marker = marker
	probe.ParentWritable = probeWritableParent(filepath.Dir(probe.TargetPath))
	return probe, nil
}

func macBundleTarget(executablePath string) string {
	parts := strings.Split(filepath.Clean(executablePath), string(os.PathSeparator))
	for index, part := range parts {
		if !strings.HasSuffix(part, ".app") {
			continue
		}
		if filepath.IsAbs(executablePath) {
			return string(os.PathSeparator) + filepath.Join(parts[1:index+1]...)
		}
		return filepath.Join(parts[:index+1]...)
	}
	return executablePath
}

func isInstalledMacBundle(bundlePath, homeDirectory string) bool {
	if filepath.Ext(bundlePath) != ".app" {
		return false
	}
	parent := filepath.Clean(filepath.Dir(bundlePath))
	if parent == filepath.Clean("/Applications") {
		return true
	}
	if strings.TrimSpace(homeDirectory) == "" {
		return false
	}
	return parent == filepath.Join(filepath.Clean(homeDirectory), "Applications")
}

func readMarkerCandidate(path string) (*MarkerCandidate, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("inspect installation marker %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read installation marker %s: %w", path, err)
	}
	return &MarkerCandidate{Path: path, Data: data}, nil
}

func probeWritableParent(parent string) bool {
	probe, err := os.CreateTemp(parent, ".luxury-yacht-update-probe-")
	if err != nil {
		return false
	}
	originalPath := probe.Name()
	renamedPath := originalPath + ".renamed"
	defer os.Remove(originalPath)
	defer os.Remove(renamedPath)
	if err := probe.Close(); err != nil {
		return false
	}
	if err := os.Rename(originalPath, renamedPath); err != nil {
		return false
	}
	return os.Remove(renamedPath) == nil
}

func packageManagerOwns(path string) bool {
	commands := [][]string{
		{"dpkg-query", "-S", path},
		{"rpm", "-qf", path},
	}
	for _, command := range commands {
		binary, err := exec.LookPath(command[0])
		if err != nil {
			continue
		}
		if exec.Command(binary, command[1:]...).Run() == nil {
			return true
		}
	}
	return false
}
