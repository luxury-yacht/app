package snapshot

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/refresh"
)

func truncateSnapshotWindow[T any](items []T, limit int) ([]T, int) {
	total := len(items)
	if limit > 0 && total > limit {
		return items[:limit], total
	}
	return items, total
}

func snapshotWindowStats(itemCount, totalItems int, noun string) refresh.SnapshotStats {
	stats := refresh.SnapshotStats{ItemCount: itemCount}
	if totalItems > itemCount {
		stats.TotalItems = totalItems
		stats.Truncated = true
		stats.Warnings = []string{
			fmt.Sprintf("Showing first %d of %d %s", itemCount, totalItems, noun),
		}
	}
	return stats
}
