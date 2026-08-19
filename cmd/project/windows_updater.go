package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	windowsMachineAMD64 = 0x8664
	windowsMachineARM64 = 0xaa64
)

func createWindowsUpdaterArtifact(
	metadata projectMetadata,
	binaryPath, outputDirectory, architecture string,
) (string, error) {
	architecture = strings.ToLower(strings.TrimSpace(architecture))
	name, err := updaterArtifactName(metadata, "windows", architecture)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(outputDirectory) == "" {
		return "", fmt.Errorf("windows updater output directory is required")
	}
	if err := validateWindowsPE(binaryPath, architecture); err != nil {
		return "", err
	}
	artifactPath := filepath.Join(outputDirectory, name)
	if err := replaceGeneratedWindowsUpdaterArtifact(binaryPath, artifactPath); err != nil {
		return "", err
	}
	return artifactPath, nil
}

func replaceGeneratedWindowsUpdaterArtifact(source, target string) error {
	temporary, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+"-*")
	if err != nil {
		return fmt.Errorf("create temporary Windows updater artifact: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Windows updater artifact: %w", err)
	}
	if err := os.Remove(temporaryPath); err != nil {
		return fmt.Errorf("prepare temporary Windows updater artifact: %w", err)
	}
	if err := copyUpdaterArtifact(source, temporaryPath); err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("replace generated Windows updater artifact: %w", err)
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return fmt.Errorf("publish generated Windows updater artifact: %w", err)
	}
	return nil
}

func validateConfiguredWindowsUpdaterExecutable(
	metadata projectMetadata,
	artifactPath, architecture string,
) error {
	architecture = strings.ToLower(strings.TrimSpace(architecture))
	artifactPath = strings.TrimSpace(artifactPath)
	expected, err := updaterArtifactName(metadata, "windows", architecture)
	if err != nil {
		return err
	}
	if filepath.Base(artifactPath) != expected {
		return fmt.Errorf("windows updater artifact name %q does not match expected %q", filepath.Base(artifactPath), expected)
	}
	return validateWindowsPE(artifactPath, architecture)
}

func validateWindowsPE(path, architecture string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect Windows updater executable: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("windows updater executable must be a regular non-symlink file: %s", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open Windows updater executable: %w", err)
	}
	defer file.Close()
	header := make([]byte, 64)
	if _, err := file.ReadAt(header, 0); err != nil {
		return fmt.Errorf("read Windows updater DOS header: %w", err)
	}
	if string(header[:2]) != "MZ" {
		return fmt.Errorf("windows updater executable has no MZ header")
	}
	peOffset := int64(binary.LittleEndian.Uint32(header[0x3c:]))
	coff := make([]byte, 6)
	if _, err := file.ReadAt(coff, peOffset); err != nil {
		return fmt.Errorf("read Windows updater PE header: %w", err)
	}
	if string(coff[:4]) != "PE\x00\x00" {
		return fmt.Errorf("windows updater executable has no PE signature")
	}
	wantMachine := uint16(windowsMachineAMD64)
	if architecture == "arm64" {
		wantMachine = windowsMachineARM64
	}
	if machine := binary.LittleEndian.Uint16(coff[4:]); machine != wantMachine {
		return fmt.Errorf("windows updater PE machine %#x does not match %s (%#x)", machine, architecture, wantMachine)
	}
	return nil
}
