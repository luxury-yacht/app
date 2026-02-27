package backend

import (
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestClusterClientBuildConcurrencyLimit(t *testing.T) {
	require.Equal(t, 0, clusterClientBuildConcurrencyLimit(0))
	require.Equal(t, 1, clusterClientBuildConcurrencyLimit(1))

	limit := runtime.GOMAXPROCS(0)
	if limit <= 0 {
		limit = 1
	}

	// Small batches run at full batch width.
	require.Equal(t, 2, clusterClientBuildConcurrencyLimit(2))

	// Large batches are capped at runtime parallelism.
	taskCount := limit + 3
	require.Equal(t, limit, clusterClientBuildConcurrencyLimit(taskCount))
}
