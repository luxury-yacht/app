package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/luxury-yacht/app/internal/updateidentity"
)

const (
	portableArchitecturePlaceholder = "__PORTABLE_ARCHITECTURE__"
	portableExecutablePlaceholder   = "__PORTABLE_EXECUTABLE__"
)

type linuxPortableArtifactsConfig struct {
	Architecture    string
	BinaryPath      string
	DesktopPath     string
	IconPath        string
	InstallerPath   string
	LicensePath     string
	MarkerPath      string
	Metadata        projectMetadata
	OutputDirectory string
	ReadmePath      string
}

type linuxPortableArtifacts struct {
	InstallerArchive string
	UpdaterArchive   string
}

type portableArchiveEntry struct {
	contents []byte
	mode     int64
	name     string
	source   string
}

func runCreateLinuxPortableArtifacts() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read Linux portable artifact metadata: %w", err)
	}
	binaryName, err := projectBinaryName(metadata)
	if err != nil {
		return err
	}
	artifacts, err := createLinuxPortableArtifacts(linuxPortableArtifactsConfig{
		Architecture:    os.Getenv("GOARCH"),
		BinaryPath:      filepath.Join("bin", binaryName),
		DesktopPath:     filepath.Join("build", "linux", "portable", "desktop"),
		IconPath:        filepath.Join("build", "appicon.png"),
		InstallerPath:   filepath.Join("build", "linux", "portable", "install.sh"),
		LicensePath:     "LICENSE",
		MarkerPath:      filepath.Join("build", "linux", "portable", "install.json"),
		Metadata:        metadata,
		OutputDirectory: "bin",
		ReadmePath:      filepath.Join("build", "linux", "portable", "README.txt"),
	})
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(os.Stdout, "Created %s\nCreated %s\n", artifacts.InstallerArchive, artifacts.UpdaterArchive)
	return err
}

func createLinuxPortableArtifacts(config linuxPortableArtifactsConfig) (linuxPortableArtifacts, error) {
	architecture := strings.ToLower(strings.TrimSpace(config.Architecture))
	updaterName, err := updaterArtifactName(config.Metadata, "linux", architecture)
	if err != nil {
		return linuxPortableArtifacts{}, err
	}
	installerName, err := releaseArtifactName(config.Metadata, "linux", architecture, "portable")
	if err != nil {
		return linuxPortableArtifacts{}, err
	}
	binaryName, err := projectBinaryName(config.Metadata)
	if err != nil {
		return linuxPortableArtifacts{}, err
	}
	if err := validateInstallLeaf("binary name", binaryName); err != nil {
		return linuxPortableArtifacts{}, err
	}
	if strings.TrimSpace(config.OutputDirectory) == "" {
		return linuxPortableArtifacts{}, fmt.Errorf("linux portable artifact output directory is required")
	}

	for label, path := range map[string]string{
		"binary": config.BinaryPath, "desktop entry": config.DesktopPath,
		"icon": config.IconPath, "installer": config.InstallerPath,
		"license": config.LicensePath, "marker": config.MarkerPath, "readme": config.ReadmePath,
	} {
		if err := validatePortableArtifactInput(label, path); err != nil {
			return linuxPortableArtifacts{}, err
		}
	}

	desktop, err := renderLinuxPortableInput(config.DesktopPath, config.Metadata, architecture)
	if err != nil {
		return linuxPortableArtifacts{}, err
	}
	if strings.Count(string(desktop), portableExecutablePlaceholder) != 1 {
		return linuxPortableArtifacts{}, fmt.Errorf(
			"linux portable desktop template must contain exactly one %s placeholder",
			portableExecutablePlaceholder,
		)
	}
	installer, err := renderLinuxPortableInput(config.InstallerPath, config.Metadata, architecture)
	if err != nil {
		return linuxPortableArtifacts{}, err
	}
	marker, err := renderLinuxPortableInput(config.MarkerPath, config.Metadata, architecture)
	if err != nil {
		return linuxPortableArtifacts{}, err
	}
	if err := validateRenderedPortableMarker(marker, binaryName); err != nil {
		return linuxPortableArtifacts{}, err
	}
	readme, err := renderLinuxPortableInput(config.ReadmePath, config.Metadata, architecture)
	if err != nil {
		return linuxPortableArtifacts{}, err
	}

	outputDirectory := filepath.Clean(config.OutputDirectory)
	if err := os.MkdirAll(outputDirectory, 0o755); err != nil {
		return linuxPortableArtifacts{}, fmt.Errorf("create Linux portable artifact directory %s: %w", outputDirectory, err)
	}
	artifacts := linuxPortableArtifacts{
		InstallerArchive: filepath.Join(outputDirectory, installerName),
		UpdaterArchive:   filepath.Join(outputDirectory, updaterName),
	}
	if err := writePortableTarGz(artifacts.UpdaterArchive, []portableArchiveEntry{{
		mode: 0o755, name: binaryName, source: config.BinaryPath,
	}}); err != nil {
		return linuxPortableArtifacts{}, err
	}
	installerRoot := strings.TrimSuffix(installerName, ".tar.gz")
	entries := []portableArchiveEntry{
		{mode: 0o644, name: path.Join(installerRoot, "LICENSE"), source: config.LicensePath},
		{contents: readme, mode: 0o644, name: path.Join(installerRoot, "README.txt")},
		{contents: installer, mode: 0o755, name: path.Join(installerRoot, "install.sh")},
		{mode: 0o755, name: path.Join(installerRoot, binaryName), source: config.BinaryPath},
		{contents: desktop, mode: 0o644, name: path.Join(installerRoot, binaryName+".desktop")},
		{contents: marker, mode: 0o644, name: path.Join(installerRoot, updateidentity.InstallationMarkerName)},
		{mode: 0o644, name: path.Join(installerRoot, binaryName+".png"), source: config.IconPath},
	}
	if err := writePortableTarGz(artifacts.InstallerArchive, entries); err != nil {
		_ = os.Remove(artifacts.UpdaterArchive)
		return linuxPortableArtifacts{}, err
	}
	if err := validateLinuxUpdaterArchive(artifacts.UpdaterArchive, config.BinaryPath, binaryName); err != nil {
		_ = os.Remove(artifacts.UpdaterArchive)
		_ = os.Remove(artifacts.InstallerArchive)
		return linuxPortableArtifacts{}, err
	}
	return artifacts, nil
}

func validatePortableArtifactInput(label, path string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("linux portable %s path is required", label)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect Linux portable %s %s: %w", label, path, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("linux portable %s must be a regular non-symlink file: %s", label, path)
	}
	return nil
}

func renderLinuxPortableInput(path string, metadata projectMetadata, architecture string) ([]byte, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read Linux portable input %s: %w", path, err)
	}
	binaryName, err := projectBinaryName(metadata)
	if err != nil {
		return nil, err
	}
	replacer := strings.NewReplacer(
		appBinaryNamePlaceholder, binaryName,
		appDescriptionPlaceholder, strings.TrimSpace(metadata.Info.Description),
		appIdentifierPlaceholder, strings.TrimSpace(metadata.Info.ProductIdentifier),
		appNamePlaceholder, strings.TrimSpace(metadata.Info.ProductName),
		appVersionPlaceholder, strings.TrimSpace(metadata.Info.Version),
		portableArchitecturePlaceholder, architecture,
	)
	return []byte(replacer.Replace(string(contents))), nil
}

func validateRenderedPortableMarker(marker []byte, binaryName string) error {
	executable := filepath.Join(string(os.PathSeparator), "portable", binaryName)
	eligibility := updateidentity.ResolveInstallation(updateidentity.InstallationProbe{
		Platform:       updateidentity.PlatformLinux,
		Architecture:   "amd64",
		TargetPath:     executable,
		ParentWritable: true,
		Marker: &updateidentity.MarkerCandidate{
			Path: filepath.Join(filepath.Dir(executable), updateidentity.InstallationMarkerName),
			Data: marker,
		},
	})
	if !eligibility.CanInstall || eligibility.Distribution != updateidentity.DistributionLinuxPortable {
		return fmt.Errorf("rendered Linux portable marker does not satisfy runtime installation identity")
	}
	return nil
}

func writePortableTarGz(path string, entries []portableArchiveEntry) (returnErr error) {
	temporary, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+"-*")
	if err != nil {
		return fmt.Errorf("create temporary Linux portable archive for %s: %w", path, err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		if returnErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()

	gzipWriter, err := gzip.NewWriterLevel(temporary, gzip.BestCompression)
	if err != nil {
		_ = temporary.Close()
		return fmt.Errorf("create gzip writer for %s: %w", path, err)
	}
	gzipWriter.Header.ModTime = time.Time{}
	gzipWriter.Header.OS = 255
	tarWriter := tar.NewWriter(gzipWriter)
	for _, entry := range entries {
		if err := writePortableTarEntry(tarWriter, entry); err != nil {
			_ = tarWriter.Close()
			_ = gzipWriter.Close()
			_ = temporary.Close()
			return fmt.Errorf("write Linux portable archive %s: %w", path, err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		_ = gzipWriter.Close()
		_ = temporary.Close()
		return fmt.Errorf("close tar archive %s: %w", path, err)
	}
	if err := gzipWriter.Close(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("close gzip archive %s: %w", path, err)
	}
	if err := temporary.Chmod(0o644); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("set Linux portable archive permissions %s: %w", path, err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Linux portable archive %s: %w", path, err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("publish Linux portable archive %s: %w", path, err)
	}
	return nil
}

func writePortableTarEntry(writer *tar.Writer, entry portableArchiveEntry) error {
	if entry.name == "" || filepath.IsAbs(entry.name) || filepath.Clean(entry.name) != entry.name || strings.HasPrefix(entry.name, "..") {
		return fmt.Errorf("unsafe archive entry name %q", entry.name)
	}
	var (
		reader io.Reader
		size   int64
		file   *os.File
	)
	if entry.source != "" {
		opened, err := os.Open(entry.source)
		if err != nil {
			return fmt.Errorf("open archive source %s: %w", entry.source, err)
		}
		file = opened
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			return fmt.Errorf("inspect archive source %s: %w", entry.source, err)
		}
		size = info.Size()
		reader = file
	} else {
		size = int64(len(entry.contents))
		reader = bytes.NewReader(entry.contents)
	}
	header := &tar.Header{
		Name: entry.name, Mode: entry.mode, Size: size, Typeflag: tar.TypeReg,
		ModTime: time.Unix(0, 0).UTC(), Format: tar.FormatUSTAR,
	}
	if err := writer.WriteHeader(header); err != nil {
		return fmt.Errorf("write archive header %s: %w", entry.name, err)
	}
	written, err := io.Copy(writer, reader)
	if err != nil {
		return fmt.Errorf("write archive entry %s: %w", entry.name, err)
	}
	if written != size {
		return fmt.Errorf("archive entry %s changed while reading: wrote %d of %d bytes", entry.name, written, size)
	}
	return nil
}

func validateLinuxUpdaterArchive(archivePath, binaryPath, binaryName string) error {
	archive, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open Linux updater archive %s: %w", archivePath, err)
	}
	defer archive.Close()
	gzipReader, err := gzip.NewReader(archive)
	if err != nil {
		return fmt.Errorf("open Linux updater gzip %s: %w", archivePath, err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	header, err := tarReader.Next()
	if err != nil {
		return fmt.Errorf("read Linux updater archive %s: %w", archivePath, err)
	}
	if header.Name != binaryName || header.Typeflag != tar.TypeReg || header.Mode&0o111 == 0 {
		return fmt.Errorf("linux updater archive must contain one executable regular file named %s", binaryName)
	}
	archiveDigest := sha256.New()
	if _, err := io.Copy(archiveDigest, tarReader); err != nil {
		return fmt.Errorf("hash Linux updater archive payload: %w", err)
	}
	if _, err := tarReader.Next(); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("linux updater archive must contain exactly one entry")
		}
		return fmt.Errorf("read trailing Linux updater archive entry: %w", err)
	}
	binary, err := os.Open(binaryPath)
	if err != nil {
		return fmt.Errorf("open Linux updater source binary %s: %w", binaryPath, err)
	}
	defer binary.Close()
	binaryDigest := sha256.New()
	if _, err := io.Copy(binaryDigest, binary); err != nil {
		return fmt.Errorf("hash Linux updater source binary: %w", err)
	}
	if !bytes.Equal(archiveDigest.Sum(nil), binaryDigest.Sum(nil)) {
		return fmt.Errorf("linux updater archive payload does not match the production binary")
	}
	return nil
}
