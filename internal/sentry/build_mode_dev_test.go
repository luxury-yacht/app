//go:build !production

package sentryreporting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWailsDevBuildDisablesSentryReporting(t *testing.T) {
	require.False(t, BuildEnabled())
}
