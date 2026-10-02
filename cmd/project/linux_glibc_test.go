package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGlibcVersionNewerComparesReleaseNumbers(t *testing.T) {
	for _, test := range []struct {
		dependency string
		newer      bool
	}{
		// Every glibc binary needs GLIBC_2.4-era symbols; a lexical comparison
		// would treat "2.4" as newer than "2.39" and reject them all.
		{dependency: "GLIBC_2.4", newer: false},
		{dependency: "GLIBC_2.3.4", newer: false},
		{dependency: "GLIBC_2.39", newer: false},
		{dependency: "GLIBC_2.40", newer: true},
		{dependency: "GLIBC_3.0", newer: true},
		// Markers without a release number do not raise the floor.
		{dependency: "GLIBC_PRIVATE", newer: false},
		{dependency: "GLIBC_ABI_DT_RELR", newer: false},
		{dependency: "GLIBCXX_3.4.40", newer: false},
	} {
		t.Run(test.dependency, func(t *testing.T) {
			require.Equal(t, test.newer, glibcVersionNewer(test.dependency, "2.39"))
		})
	}
}

func TestValidateLinuxGlibcFloorReadsTheLoaderRequirements(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("reads a glibc-linked Linux executable")
	}
	if _, err := exec.LookPath("getconf"); err != nil {
		t.Skip("needs a glibc host")
	}
	shell, err := exec.LookPath("sh")
	require.NoError(t, err)
	shell, err = filepath.EvalSymlinks(shell)
	require.NoError(t, err)

	// Any glibc-linked executable needs versions newer than 2.0 and none
	// newer than a far-future floor.
	err = validateLinuxGlibcFloor(shell, "2.0")
	require.ErrorContains(t, err, "requires GLIBC_2.")
	require.ErrorContains(t, err, "newer than the glibc 2.0 floor")
	require.NoError(t, validateLinuxGlibcFloor(shell, "999.0"))
}
