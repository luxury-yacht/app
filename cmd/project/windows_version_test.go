package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

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
