//go:build production

package sentryreporting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProductionBuildEnablesSentryReporting(t *testing.T) {
	require.True(t, BuildEnabled())
}
