//go:build server

package updateidentity_test

import (
	"testing"

	"github.com/luxury-yacht/app/internal/updateidentity"
	"github.com/stretchr/testify/require"
)

func TestCurrentBuildIsServerForServerBuild(t *testing.T) {
	t.Parallel()

	require.True(t, updateidentity.CurrentBuildIsServer)
}
