package containerlogs

import (
	"cmp"
	"slices"
	"time"
)

// orderKey places a log entry in time order: by its log timestamp, with entries
// whose timestamp does not parse after all others, and arrival order (seq)
// between entries that otherwise tie. The timestamp is kept as Unix
// nanoseconds, exact for any date a log can carry, so comparing is cheap.
type orderKey struct {
	nanos int64
	timed bool
	seq   int
}

func newOrderKey(timestamp string, seq int) orderKey {
	at, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return orderKey{seq: seq}
	}
	return orderKey{nanos: at.UnixNano(), timed: true, seq: seq}
}

func (k orderKey) compare(other orderKey) int {
	switch {
	case k.timed != other.timed:
		if k.timed {
			return -1
		}
		return 1
	case k.nanos != other.nanos:
		return cmp.Compare(k.nanos, other.nanos)
	default:
		return cmp.Compare(k.seq, other.seq)
	}
}

type keyedEntry[T any] struct {
	entry T
	key   orderKey
}

func sortKeyed[T any](entries []keyedEntry[T]) {
	slices.SortFunc(entries, func(a, b keyedEntry[T]) int { return a.key.compare(b.key) })
}

// SortByTimestamp orders entries oldest first by their log timestamp. Lines
// that share a timestamp keep their input order, so a multi-line burst from one
// container stays intact. Entries without a parseable timestamp go last, in
// input order.
func SortByTimestamp[T any](entries []T, timestamp func(T) string) {
	if len(entries) < 2 {
		return
	}
	keyed := make([]keyedEntry[T], len(entries))
	for i, entry := range entries {
		keyed[i] = keyedEntry[T]{entry: entry, key: newOrderKey(timestamp(entry), i)}
	}
	sortKeyed(keyed)
	for i := range keyed {
		entries[i] = keyed[i].entry
	}
}

// NewestWindow keeps the newest entries that fit a count and a size limit as
// entries arrive in any order, in the order SortByTimestamp gives. Entries are
// collected until they reach twice either limit, then sorted and cut back to
// the newest that fit, so it holds at most twice its limits and sorts rarely.
type NewestWindow[T any] struct {
	maxEntries int
	maxBytes   int
	timestamp  func(T) string
	size       func(T) int
	held       []keyedEntry[T]
	bytes      int
	leftOut    int
	seq        int
}

// NewNewestWindow returns a window keeping at most maxEntries entries whose
// sizes total at most maxBytes.
func NewNewestWindow[T any](maxEntries, maxBytes int, timestamp func(T) string, size func(T) int) *NewestWindow[T] {
	return &NewestWindow[T]{maxEntries: maxEntries, maxBytes: maxBytes, timestamp: timestamp, size: size}
}

// Add offers an entry to the window.
func (w *NewestWindow[T]) Add(entry T) {
	w.held = append(w.held, keyedEntry[T]{entry: entry, key: newOrderKey(w.timestamp(entry), w.seq)})
	w.seq++
	w.bytes += w.size(entry)
	if len(w.held) >= 2*w.maxEntries || w.bytes >= 2*w.maxBytes {
		w.compact()
	}
}

// Len returns the number of entries currently held.
func (w *NewestWindow[T]) Len() int {
	return len(w.held)
}

// Take returns the newest entries that fit, oldest first, and how many entries
// were left out. The window is empty afterwards.
func (w *NewestWindow[T]) Take() ([]T, int) {
	w.compact()
	kept := make([]T, len(w.held))
	for i := range w.held {
		kept[i] = w.held[i].entry
	}
	leftOut := w.leftOut
	w.held, w.bytes, w.leftOut = nil, 0, 0
	return kept, leftOut
}

// Kept returns the newest entries that fit, oldest first, and how many entries
// have been left out so far, leaving the window as it was.
func (w *NewestWindow[T]) Kept() ([]T, int) {
	w.compact()
	kept := make([]T, len(w.held))
	for i := range w.held {
		kept[i] = w.held[i].entry
	}
	return kept, w.leftOut
}

// compact sorts the held entries and keeps the newest run that fits both
// limits, as far back as the first entry that does not fit.
func (w *NewestWindow[T]) compact() {
	sortKeyed(w.held)
	start, bytes := len(w.held), 0
	for start > 0 {
		size := w.size(w.held[start-1].entry)
		if len(w.held)-start+1 > w.maxEntries || bytes+size > w.maxBytes {
			break
		}
		bytes += size
		start--
	}
	w.leftOut += start
	w.held = append(w.held[:0], w.held[start:]...)
	w.bytes = bytes
}
