package containerlogs

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type orderedLine struct {
	timestamp string
	text      string
}

// A multi-line burst shares one timestamp; merging it with another container
// must keep the burst in its written order (40 lines is past the small-slice
// insertion sort that would hide an unstable sort).
func TestSortByTimestampKeepsSameTimestampBurstsInOrder(t *testing.T) {
	base := time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC)
	burst := base.Add(time.Second).Format(time.RFC3339Nano)
	var lines []orderedLine
	for i := range 40 {
		lines = append(lines, orderedLine{timestamp: base.Add(time.Duration(i) * 50 * time.Millisecond).Format(time.RFC3339Nano), text: fmt.Sprintf("other-%02d", i)})
	}
	for i := range 40 {
		lines = append(lines, orderedLine{timestamp: burst, text: fmt.Sprintf("trace-%02d", i)})
	}
	lines = append(lines, orderedLine{timestamp: "", text: "untimed-1"}, orderedLine{timestamp: "not-a-time", text: "untimed-2"})

	SortByTimestamp(lines, func(line orderedLine) string { return line.timestamp })

	var trace []string
	for _, line := range lines {
		if len(line.text) > 5 && line.text[:5] == "trace" {
			trace = append(trace, line.text)
		}
	}
	for i, text := range trace {
		require.Equal(t, fmt.Sprintf("trace-%02d", i), text)
	}
	require.Equal(t, "untimed-1", lines[len(lines)-2].text, "entries without timestamps go last in input order")
	require.Equal(t, "untimed-2", lines[len(lines)-1].text)
}

func windowOf(maxEntries, maxBytes int) *NewestWindow[orderedLine] {
	return NewNewestWindow(maxEntries, maxBytes,
		func(line orderedLine) string { return line.timestamp },
		func(line orderedLine) int { return len(line.text) })
}

func texts(lines []orderedLine) []string {
	out := make([]string, len(lines))
	for i, line := range lines {
		out[i] = line.text
	}
	return out
}

// Containers answer in parallel, so the newest lines can arrive first or last;
// the window keeps the newest whatever the arrival order.
func TestNewestWindowKeepsTheNewestEntriesWhateverTheArrivalOrder(t *testing.T) {
	base := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	at := func(ms int) string { return base.Add(time.Duration(ms) * time.Millisecond).Format(time.RFC3339Nano) }
	window := windowOf(3, 1<<20)
	// A fast container's old history, then a slow container's newer history.
	for i := range 5 {
		window.Add(orderedLine{timestamp: at(i), text: fmt.Sprintf("fast-%d", i)})
	}
	for i := range 5 {
		window.Add(orderedLine{timestamp: at(100 + i), text: fmt.Sprintf("slow-%d", i)})
	}
	// A live line from the fast container, newest of all, then more old history.
	window.Add(orderedLine{timestamp: at(500), text: "live"})
	window.Add(orderedLine{timestamp: at(50), text: "older"})

	kept, leftOut := window.Take()
	require.Equal(t, []string{"slow-3", "slow-4", "live"}, texts(kept))
	require.Equal(t, 9, leftOut)
}

func TestNewestWindowKeepsSameTimestampEntriesInArrivalOrder(t *testing.T) {
	burst := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	window := windowOf(40, 1<<20)
	for i := range 100 {
		window.Add(orderedLine{timestamp: burst, text: fmt.Sprintf("trace-%02d", i)})
	}
	kept, leftOut := window.Take()
	want := make([]string, 40)
	for i := range want {
		want[i] = fmt.Sprintf("trace-%02d", 60+i)
	}
	require.Equal(t, want, texts(kept))
	require.Equal(t, 60, leftOut)
}

// Lines without a parseable timestamp go last in SortByTimestamp, so the
// window treats them as the newest too.
func TestNewestWindowTreatsUntimedEntriesAsNewest(t *testing.T) {
	window := windowOf(2, 1<<20)
	window.Add(orderedLine{timestamp: "", text: "untimed"})
	window.Add(orderedLine{timestamp: time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC).Format(time.RFC3339Nano), text: "timed-new"})
	window.Add(orderedLine{timestamp: time.Date(2026, 9, 29, 9, 0, 0, 0, time.UTC).Format(time.RFC3339Nano), text: "timed-old"})
	kept, _ := window.Take()
	require.Equal(t, []string{"timed-new", "untimed"}, texts(kept))
}

func TestNewestWindowKeepsTheNewestEntriesWithinTheByteLimit(t *testing.T) {
	base := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	window := windowOf(100, 10)
	for i, text := range []string{"aaaa", "bbbb", "cccc", "dd"} {
		window.Add(orderedLine{timestamp: base.Add(time.Duration(i) * time.Second).Format(time.RFC3339Nano), text: text})
	}
	kept, leftOut := window.Take()
	require.Equal(t, []string{"bbbb", "cccc", "dd"}, texts(kept))
	require.Equal(t, 1, leftOut)
}

// However much history arrives, the window holds at most twice its limits.
func TestNewestWindowNeverHoldsMoreThanTwiceItsLimits(t *testing.T) {
	base := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	window := windowOf(100, 1<<20)
	for i := range 10_000 {
		window.Add(orderedLine{timestamp: base.Add(time.Duration(i%977) * time.Millisecond).Format(time.RFC3339Nano), text: "x"})
		require.LessOrEqual(t, window.Len(), 200)
	}
	byBytes := windowOf(1000, 100)
	for i := range 1000 {
		byBytes.Add(orderedLine{timestamp: base.Add(time.Duration(i) * time.Millisecond).Format(time.RFC3339Nano), text: "0123456789"})
		require.LessOrEqual(t, byBytes.Len(), 20)
	}
}

// A session keeps a window of the lines it sent to learn what the client still
// holds; looking must not empty it.
func TestNewestWindowKeptLeavesTheWindowAsItWas(t *testing.T) {
	base := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	at := func(ms int) string { return base.Add(time.Duration(ms) * time.Millisecond).Format(time.RFC3339Nano) }
	window := windowOf(2, 1<<20)
	for i := range 3 {
		window.Add(orderedLine{timestamp: at(i), text: fmt.Sprintf("line-%d", i)})
	}

	kept, leftOut := window.Kept()
	require.Equal(t, []string{"line-1", "line-2"}, texts(kept))
	require.Equal(t, 1, leftOut)
	window.Add(orderedLine{timestamp: at(3), text: "line-3"})
	kept, leftOut = window.Take()
	require.Equal(t, []string{"line-2", "line-3"}, texts(kept))
	require.Equal(t, 2, leftOut)
}
