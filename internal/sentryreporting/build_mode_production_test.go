//go:build !dev

package sentryreporting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProductionBuildEnablesSentryReporting(t *testing.T) {
	require.True(t, BuildEnabled())
}
