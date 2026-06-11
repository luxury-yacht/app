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

func TestSnapshotVersionWithDynamicRevisionPreservesResourceVersionWhenDynamicRevisionMissing(t *testing.T) {
	require.Equal(t, uint64(42), snapshotVersionWithDynamicRevision(42, ""))
	require.Equal(t, uint64(42), snapshotVersionWithDynamicRevision(42, "   "))
}

func TestSnapshotVersionWithDynamicRevisionChangesForEitherDimension(t *testing.T) {
	base := snapshotVersionWithDynamicRevision(42, "1700000000000000000")
	resourceChanged := snapshotVersionWithDynamicRevision(43, "1700000000000000000")
	dynamicChanged := snapshotVersionWithDynamicRevision(42, "1700000001000000000")

	require.NotEqual(t, uint64(42), base)
	require.NotEqual(t, base, resourceChanged)
	require.NotEqual(t, base, dynamicChanged)
	require.Equal(t, base, snapshotVersionWithDynamicRevision(42, "1700000000000000000"))
}
