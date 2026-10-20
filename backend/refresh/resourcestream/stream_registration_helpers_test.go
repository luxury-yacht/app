package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestManagerCanListWatchAllowsUngatedManagers(t *testing.T) {
	manager := &Manager{}

	require.True(t, manager.canListWatch("", "pods"))
	require.True(t, manager.canListWatch("apps", "deployments"))
}
