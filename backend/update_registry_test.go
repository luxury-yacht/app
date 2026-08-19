package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWindowsDisplayVersionMatchesInstallerTagFormat(t *testing.T) {
	t.Parallel()

	displayVersion, err := windowsDisplayVersion("2.0.0-beta.4")

	require.NoError(t, err)
	require.Equal(t, "v2.0.0-beta.4", displayVersion)

	_, err = windowsDisplayVersion("not-a-release")
	require.ErrorContains(t, err, "validate Windows Installed Apps version")
}
