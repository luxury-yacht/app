package containerlogs

import (
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/require"
)

func readAllLines(t *testing.T, input io.Reader) ([]string, error) {
	t.Helper()
	reader := NewLineReader(input)
	var lines []string
	for {
		line, err := reader.Next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return lines, nil
			}
			return lines, err
		}
		lines = append(lines, line)
	}
}

// One oversized line must not stop the lines after it from being read.
func TestLineReaderTruncatesOversizedLinesAndKeepsReading(t *testing.T) {
	huge := strings.Repeat("x", MaxLineBytes+1234)
	lines, err := readAllLines(t, strings.NewReader("before\n"+huge+"\nafter\n"))
	require.NoError(t, err)
	require.Len(t, lines, 3)
	require.Equal(t, "before", lines[0])
	require.Equal(t, strings.Repeat("x", MaxLineBytes)+" … [truncated 1234 bytes]", lines[1])
	require.Equal(t, "after", lines[2])
}

func TestLineReaderKeepsLinesAtTheLimitWhole(t *testing.T) {
	exact := strings.Repeat("y", MaxLineBytes)
	lines, err := readAllLines(t, strings.NewReader(exact+"\n"))
	require.NoError(t, err)
	require.Equal(t, []string{exact}, lines)
}

// The cut must not split a multi-byte character, or the entry would carry
// invalid UTF-8 to the frontend.
func TestLineReaderCutsOnARuneBoundary(t *testing.T) {
	line := strings.Repeat("a", MaxLineBytes-1) + "€€€"
	lines, err := readAllLines(t, strings.NewReader(line+"\n"))
	require.NoError(t, err)
	require.Len(t, lines, 1)
	require.True(t, utf8.ValidString(lines[0]))
	require.Equal(t, strings.Repeat("a", MaxLineBytes-1)+" … [truncated 9 bytes]", lines[0])
}

func TestLineReaderMatchesLineScanningEdges(t *testing.T) {
	lines, err := readAllLines(t, strings.NewReader("windows\r\n\nlast without newline"))
	require.NoError(t, err)
	require.Equal(t, []string{"windows", "", "last without newline"}, lines)
}

// A stream that breaks mid-line never delivers the half it received: the
// resumed stream reads the whole line, and a half line would not match it.
func TestLineReaderDropsALineCutOffByAReadError(t *testing.T) {
	failure := errors.New("connection reset")
	lines, err := readAllLines(t, io.MultiReader(strings.NewReader("one\ntw"), failingReader{err: failure}))
	require.ErrorIs(t, err, failure)
	require.Equal(t, []string{"one"}, lines)
}

func TestLineReaderReturnsAFinalLineWithoutANewline(t *testing.T) {
	lines, err := readAllLines(t, strings.NewReader("one\ntwo"))
	require.NoError(t, err)
	require.Equal(t, []string{"one", "two"}, lines)
}

type failingReader struct{ err error }

func (r failingReader) Read([]byte) (int, error) { return 0, r.err }

func TestSplitTimestampParsesTheLeadingTimestamp(t *testing.T) {
	for _, test := range []struct {
		name      string
		line      string
		timestamp string
		content   string
	}{
		{name: "utc", line: "2026-09-28T10:00:00.123456789Z started", timestamp: "2026-09-28T10:00:00.123456789Z", content: "started"},
		{name: "numeric offset is normalized to UTC", line: "2026-09-28T10:00:00.5-05:00 started", timestamp: "2026-09-28T15:00:00.5Z", content: "started"},
		{name: "empty content", line: "2026-09-28T10:00:00Z ", timestamp: "2026-09-28T10:00:00Z", content: ""},
		{name: "first word is not a timestamp", line: "short words stay whole", timestamp: "", content: "short words stay whole"},
		{name: "no space", line: "no-space-line", timestamp: "", content: "no-space-line"},
	} {
		t.Run(test.name, func(t *testing.T) {
			timestamp, content := SplitTimestamp(test.line)
			require.Equal(t, test.timestamp, timestamp)
			require.Equal(t, test.content, content)
		})
	}
}

// WireText must equal what the client receives after JSON encoding, so a line
// the client sends back matches the line as the log stream reads it.
func TestWireTextMatchesTheJSONEncoding(t *testing.T) {
	for _, text := range []string{"plain", "caf\u00e9 \U0001F600", "bad \xff\xfe byte", "\xc3", "cut \xe2\x82", ""} {
		encoded, err := json.Marshal(text)
		require.NoError(t, err)
		var received string
		require.NoError(t, json.Unmarshal(encoded, &received))
		require.Equal(t, received, WireText(text), "%q", text)
	}
}
