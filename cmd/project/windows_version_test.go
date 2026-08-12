package main

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWriteWindowsVersion(t *testing.T) {
	var output bytes.Buffer

	err := WriteWindowsVersion(&output, "1.2.3-beta.5")

	require.NoError(t, err)
	require.Equal(t, "1.2.3.5\n", output.String())
}

func TestWriteWindowsVersionRejectsInvalidVersion(t *testing.T) {
	var output bytes.Buffer

	err := WriteWindowsVersion(&output, "beta")

	require.EqualError(t, err, `invalid semantic version "beta"`)
	require.Empty(t, output.String())
}
