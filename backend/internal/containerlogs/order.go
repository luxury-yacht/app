package containerlogs

import (
	"sort"
	"time"
)

// SortByTimestamp orders entries oldest first by their log timestamp. Lines
// that share a timestamp keep their input order, so a multi-line burst from one
// container stays intact. Entries without a parseable timestamp go last, in
// input order.
func SortByTimestamp[T any](entries []T, timestamp func(T) string) {
	if len(entries) < 2 {
		return
	}
	type keyed struct {
		entry T
		at    time.Time
		ok    bool
	}
	keyedEntries := make([]keyed, len(entries))
	for i, entry := range entries {
		at, err := time.Parse(time.RFC3339Nano, timestamp(entry))
		keyedEntries[i] = keyed{entry: entry, at: at, ok: err == nil}
	}
	sort.SliceStable(keyedEntries, func(i, j int) bool {
		left, right := keyedEntries[i], keyedEntries[j]
		if left.ok != right.ok {
			return left.ok
		}
		return left.ok && left.at.Before(right.at)
	})
	for i := range keyedEntries {
		entries[i] = keyedEntries[i].entry
	}
}
