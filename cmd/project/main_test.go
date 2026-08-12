package main

import (
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
