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
