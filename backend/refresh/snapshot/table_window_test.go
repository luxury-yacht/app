package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSnapshotWindowStatsMarksTruncatedWindows(t *testing.T) {
	stats := snapshotWindowStats(1000, 1001, "rows")

	require.Equal(t, 1000, stats.ItemCount)
	require.Equal(t, 1001, stats.TotalItems)
	require.True(t, stats.Truncated)
	require.Contains(t, stats.Warnings[0], "Showing first 1000 of 1001 rows")
}

func TestTruncateSnapshotWindowKeepsCompleteWindowsUnmarked(t *testing.T) {
	rows, total := truncateSnapshotWindow([]int{1, 2, 3}, 10)
	stats := snapshotWindowStats(len(rows), total, "rows")

	require.Equal(t, []int{1, 2, 3}, rows)
	require.Equal(t, 3, total)
	require.False(t, stats.Truncated)
	require.Empty(t, stats.TotalItems)
	require.Empty(t, stats.Warnings)
}
