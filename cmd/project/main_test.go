package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunRejectsUnknownCommandBeforeLoadingProjectFiles(t *testing.T) {
	t.Chdir(t.TempDir())

	err := run([]string{"unknown"})

	require.EqualError(t, err, `unknown project command "unknown"`)
}

func TestRunRejectsRemovedVersionCommands(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, command := range []string{"version", "windows-version"} {
		t.Run(command, func(t *testing.T) {
			err := run([]string{command})
			require.EqualError(t, err, `unknown project command "`+command+`"`)
		})
	}
}

func TestRunFormattingWithoutProjectConfiguration(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test helper uses a POSIX executable")
	}
	t.Chdir(t.TempDir())
	binDir := t.TempDir()
	gofmtPath := filepath.Join(binDir, "gofmt")
	require.NoError(t, os.WriteFile(gofmtPath, []byte("#!/bin/sh\nexit 0\n"), 0o755))
	t.Setenv("PATH", binDir)

	require.NoError(t, run([]string{"fmt"}))
}

func TestWriteConfiguredProductNamePreservesDisplayName(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "build"), 0o755))
	require.NoError(t, os.WriteFile(
		filepath.Join(root, "build", "config.yml"),
		[]byte("info:\n  productName: Luxury Yacht\n  version: v2.0.0\n"),
		0o644,
	))
	t.Chdir(root)
	var output bytes.Buffer

	err := writeConfiguredProductName(&output)

	require.NoError(t, err)
	require.Equal(t, "Luxury Yacht\n", output.String())
}

func TestWriteConfiguredProductNameReportsInvalidConfiguration(t *testing.T) {
	t.Run("missing config", func(t *testing.T) {
		t.Chdir(t.TempDir())

		err := writeConfiguredProductName(&bytes.Buffer{})

		require.ErrorContains(t, err, "read product name")
	})

	t.Run("missing product name", func(t *testing.T) {
		root := t.TempDir()
		require.NoError(t, os.MkdirAll(filepath.Join(root, "build"), 0o755))
		require.NoError(t, os.WriteFile(
			filepath.Join(root, "build", "config.yml"),
			[]byte("info:\n  version: v2.0.0\n"),
			0o644,
		))
		t.Chdir(root)

		err := writeConfiguredProductName(&bytes.Buffer{})

		require.ErrorContains(t, err, "has no info.productName")
	})
}
