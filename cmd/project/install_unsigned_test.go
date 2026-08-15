package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestInstallUnsignedLinuxCopiesBinaryToUserLocalBin(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0o755))
	source := filepath.Join(binDir, "luxury-yacht")
	require.NoError(t, os.WriteFile(source, []byte("linux binary"), 0o751))

	var output bytes.Buffer
	err := installUnsigned(unsignedInstallConfig{
		binDir:   binDir,
		goos:     "linux",
		homeDir:  filepath.Join(root, "home"),
		metadata: testInstallMetadata(),
		output:   &output,
	})

	require.NoError(t, err)
	destination := filepath.Join(root, "home", ".local", "bin", "luxury-yacht")
	contents, err := os.ReadFile(destination)
	require.NoError(t, err)
	require.Equal(t, "linux binary", string(contents))
	require.Contains(t, output.String(), destination)
}

func TestInstallUnsignedWindowsCopiesBinaryToLocalAppData(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(binDir, "luxury-yacht.exe"), []byte("windows binary"), 0o644))

	err := installUnsigned(unsignedInstallConfig{
		binDir:       binDir,
		goos:         "windows",
		localAppData: filepath.Join(root, "local-app-data"),
		metadata:     testInstallMetadata(),
		output:       &bytes.Buffer{},
	})

	require.NoError(t, err)
	destination := filepath.Join(root, "local-app-data", "Programs", "Luxury Yacht", "luxury-yacht.exe")
	contents, err := os.ReadFile(destination)
	require.NoError(t, err)
	require.Equal(t, "windows binary", string(contents))
}

func TestInstallUnsignedWindowsFallsBackToHomeDirectory(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(binDir, "luxury-yacht.exe"), []byte("windows binary"), 0o644))

	err := installUnsigned(unsignedInstallConfig{
		binDir:   binDir,
		goos:     "windows",
		homeDir:  filepath.Join(root, "home"),
		metadata: testInstallMetadata(),
		output:   &bytes.Buffer{},
	})

	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(root, "home", "Luxury Yacht", "luxury-yacht.exe"))
	require.NoError(t, err)
}

func TestInstallUnsignedMacOSReplacesApplicationsBundleWithSudo(t *testing.T) {
	root := t.TempDir()
	binDir := filepath.Join(root, "bin")
	require.NoError(t, os.MkdirAll(filepath.Join(binDir, "Luxury Yacht.app"), 0o755))

	var commands [][]string
	err := installUnsigned(unsignedInstallConfig{
		applicationsDir: "/Applications",
		binDir:          binDir,
		goos:            "darwin",
		metadata:        testInstallMetadata(),
		output:          &bytes.Buffer{},
		run: func(name string, args ...string) error {
			commands = append(commands, append([]string{name}, args...))
			return nil
		},
	})

	require.NoError(t, err)
	destination := filepath.Join("/Applications", "Luxury Yacht.app")
	require.Equal(t, [][]string{
		{"sudo", "rm", "-rf", destination},
		{"sudo", "cp", "-R", filepath.Join(binDir, "Luxury Yacht.app"), destination},
	}, commands)
}

func TestInstallUnsignedRejectsUnsupportedPlatformAndUnsafeProductName(t *testing.T) {
	t.Run("platform", func(t *testing.T) {
		err := installUnsigned(unsignedInstallConfig{
			goos:     "plan9",
			metadata: testInstallMetadata(),
			output:   &bytes.Buffer{},
		})
		require.EqualError(t, err, "unsigned install is not supported on plan9")
	})

	t.Run("product name", func(t *testing.T) {
		metadata := testInstallMetadata()
		metadata.Info.ProductName = "../Luxury Yacht"
		err := installUnsigned(unsignedInstallConfig{
			goos:     "linux",
			metadata: metadata,
			output:   &bytes.Buffer{},
		})
		require.ErrorContains(t, err, "unsafe product name")
	})
}

func TestInstallUnsignedMacOSErrors(t *testing.T) {
	newConfig := func(t *testing.T) unsignedInstallConfig {
		root := t.TempDir()
		binDir := filepath.Join(root, "bin")
		require.NoError(t, os.MkdirAll(filepath.Join(binDir, "Luxury Yacht.app"), 0o755))
		return unsignedInstallConfig{
			applicationsDir: "/Applications",
			binDir:          binDir,
			goos:            "darwin",
			metadata:        testInstallMetadata(),
			output:          &bytes.Buffer{},
		}
	}

	t.Run("missing bundle", func(t *testing.T) {
		config := newConfig(t)
		config.binDir = t.TempDir()
		err := installUnsigned(config)
		require.ErrorContains(t, err, "macOS app bundle not found")
	})

	t.Run("bundle is file", func(t *testing.T) {
		config := newConfig(t)
		require.NoError(t, os.RemoveAll(filepath.Join(config.binDir, "Luxury Yacht.app")))
		require.NoError(t, os.WriteFile(filepath.Join(config.binDir, "Luxury Yacht.app"), []byte("file"), 0o644))
		err := installUnsigned(config)
		require.ErrorContains(t, err, "is not a directory")
	})

	t.Run("no runner", func(t *testing.T) {
		err := installUnsigned(newConfig(t))
		require.ErrorContains(t, err, "has no command runner")
	})

	t.Run("remove", func(t *testing.T) {
		config := newConfig(t)
		config.run = func(string, ...string) error { return errors.New("remove failed") }
		err := installUnsigned(config)
		require.ErrorContains(t, err, "remove existing macOS app bundle")
	})

	t.Run("copy", func(t *testing.T) {
		config := newConfig(t)
		calls := 0
		config.run = func(string, ...string) error {
			calls++
			if calls == 2 {
				return errors.New("copy failed")
			}
			return nil
		}
		err := installUnsigned(config)
		require.ErrorContains(t, err, "install macOS app bundle")
	})
}

func TestCopyInstalledBinaryRejectsInvalidPaths(t *testing.T) {
	t.Run("missing source", func(t *testing.T) {
		err := copyInstalledBinary(filepath.Join(t.TempDir(), "missing"), filepath.Join(t.TempDir(), "destination"))
		require.ErrorContains(t, err, "install source not found")
	})

	t.Run("source directory", func(t *testing.T) {
		err := copyInstalledBinary(t.TempDir(), filepath.Join(t.TempDir(), "destination"))
		require.ErrorContains(t, err, "is not a regular file")
	})

	t.Run("blocked destination directory", func(t *testing.T) {
		root := t.TempDir()
		source := filepath.Join(root, "source")
		require.NoError(t, os.WriteFile(source, []byte("binary"), 0o755))
		blocked := filepath.Join(root, "blocked")
		require.NoError(t, os.WriteFile(blocked, []byte("file"), 0o644))
		err := copyInstalledBinary(source, filepath.Join(blocked, "destination"))
		require.ErrorContains(t, err, "create install directory")
	})

	t.Run("destination is directory", func(t *testing.T) {
		root := t.TempDir()
		source := filepath.Join(root, "source")
		require.NoError(t, os.WriteFile(source, []byte("binary"), 0o755))
		destination := filepath.Join(root, "destination")
		require.NoError(t, os.Mkdir(destination, 0o755))
		err := copyInstalledBinary(source, destination)
		require.ErrorContains(t, err, "install binary")
	})
}

func testInstallMetadata() projectMetadata {
	var metadata projectMetadata
	metadata.Info.ProductName = "Luxury Yacht"
	return metadata
}
