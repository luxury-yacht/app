package main

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWriteWindowsVersion(t *testing.T) {
	var output bytes.Buffer

	err := writeWindowsVersion(&output, "1.2.3-beta.5")

	require.NoError(t, err)
	require.Equal(t, "1.2.3.5\n", output.String())
}

func TestWriteWindowsVersionRejectsInvalidVersion(t *testing.T) {
	var output bytes.Buffer

	err := writeWindowsVersion(&output, "beta")

	require.EqualError(t, err, `invalid semantic version "beta"`)
	require.Empty(t, output.String())
}

func TestWindowsNumericVersion(t *testing.T) {
	tests := map[string]string{
		"v1.2.3":        "1.2.3.1000",
		"1.2.3-beta.5":  "1.2.3.5",
		"1.2.3-rc":      "1.2.3.0",
		"1.2.3+build.7": "1.2.3.1000",
	}
	for version, want := range tests {
		t.Run(version, func(t *testing.T) {
			got, err := windowsNumericVersion(version)
			require.NoError(t, err)
			require.Equal(t, want, got)
		})
	}
}

func TestWindowsNumericVersionRejectsInvalidVersion(t *testing.T) {
	_, err := windowsNumericVersion("beta")
	require.EqualError(t, err, `invalid semantic version "beta"`)
}
