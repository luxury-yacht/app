package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type unsignedInstallConfig struct {
	applicationsDir string
	binDir          string
	goos            string
	homeDir         string
	localAppData    string
	metadata        projectMetadata
	output          io.Writer
	run             func(string, ...string) error
}

func runUnsignedInstall() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return err
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve user home directory: %w", err)
	}
	return installUnsigned(unsignedInstallConfig{
		applicationsDir: "/Applications",
		binDir:          "bin",
		goos:            runtime.GOOS,
		homeDir:         homeDir,
		localAppData:    os.Getenv("LOCALAPPDATA"),
		metadata:        metadata,
		output:          os.Stdout,
		run:             runCommand,
	})
}

func installUnsigned(config unsignedInstallConfig) error {
	if err := validateUnsignedInstallPlatform(config.goos); err != nil {
		return err
	}
	productName := strings.TrimSpace(config.metadata.Info.ProductName)
	if err := validateInstallLeaf("product name", productName); err != nil {
		return err
	}
	binaryName, err := projectBinaryName(config.metadata)
	if err != nil {
		return err
	}
	if err := validateInstallLeaf("binary name", binaryName); err != nil {
		return err
	}

	destination, err := installUnsignedForPlatform(config, productName, binaryName)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(config.output, "Successfully installed %s to %s\n", productName, destination)
	return err
}

func validateUnsignedInstallPlatform(goos string) error {
	switch goos {
	case "darwin", "linux", "windows":
		return nil
	default:
		return fmt.Errorf("unsigned install is not supported on %s", goos)
	}
}

func installUnsignedForPlatform(config unsignedInstallConfig, productName, binaryName string) (string, error) {
	switch config.goos {
	case "darwin":
		return installUnsignedMacOS(config, productName, binaryName)
	case "linux":
		return installUnsignedLinux(config, binaryName)
	case "windows":
		return installUnsignedWindows(config, productName, binaryName)
	default:
		return "", fmt.Errorf("unsigned install is not supported on %s", config.goos)
	}
}

func installUnsignedMacOS(config unsignedInstallConfig, productName, binaryName string) (string, error) {
	source := filepath.Join(config.binDir, binaryName+".app")
	info, err := os.Stat(source)
	if err != nil {
		return "", fmt.Errorf("macOS app bundle not found at %s: %w", source, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("macOS app bundle at %s is not a directory", source)
	}
	destination := filepath.Join(config.applicationsDir, productName+".app")
	if config.run == nil {
		return "", fmt.Errorf("macOS unsigned install has no command runner")
	}
	if err := config.run("sudo", "rm", "-rf", destination); err != nil {
		return "", fmt.Errorf("remove existing macOS app bundle %s: %w", destination, err)
	}
	if err := config.run("sudo", "cp", "-R", source, destination); err != nil {
		return "", fmt.Errorf("install macOS app bundle to %s: %w", destination, err)
	}
	return destination, nil
}

func installUnsignedLinux(config unsignedInstallConfig, binaryName string) (string, error) {
	destination := filepath.Join(config.homeDir, ".local", "bin", binaryName)
	if err := copyInstalledBinary(filepath.Join(config.binDir, binaryName), destination); err != nil {
		return "", err
	}
	return destination, nil
}

func installUnsignedWindows(config unsignedInstallConfig, productName, binaryName string) (string, error) {
	installRoot := config.localAppData
	if installRoot == "" {
		installRoot = config.homeDir
	} else {
		installRoot = filepath.Join(installRoot, "Programs")
	}
	destination := filepath.Join(installRoot, productName, binaryName+".exe")
	if err := copyInstalledBinary(filepath.Join(config.binDir, binaryName+".exe"), destination); err != nil {
		return "", err
	}
	return destination, nil
}

func validateInstallLeaf(label, value string) error {
	if value == "" || value == "." || value == ".." || filepath.Base(value) != value || strings.ContainsAny(value, `/\\`) {
		return fmt.Errorf("unsafe %s %q", label, value)
	}
	return nil
}

func copyInstalledBinary(source, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return fmt.Errorf("install source not found at %s: %w", source, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("install source at %s is not a regular file", source)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return fmt.Errorf("create install directory for %s: %w", destination, err)
	}
	contents, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("read install source %s: %w", source, err)
	}
	if err := os.WriteFile(destination, contents, info.Mode().Perm()); err != nil {
		return fmt.Errorf("install binary to %s: %w", destination, err)
	}
	return nil
}
