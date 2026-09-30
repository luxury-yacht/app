package containerlogs

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"
)

// MaxLineBytes is the longest log line kept. Longer lines are cut to this size
// and end with a marker giving the number of bytes dropped.
const MaxLineBytes = 256 * 1024

const lineReaderBufferBytes = 64 * 1024

// LineReader reads newline-delimited log lines of any length without failing
// on long ones.
type LineReader struct {
	reader *bufio.Reader
	err    error
}

func NewLineReader(r io.Reader) *LineReader {
	return &LineReader{reader: bufio.NewReaderSize(r, lineReaderBufferBytes)}
}

// Next returns the next line without its line ending. A final line with no
// newline is still returned at the end of the stream, and io.EOF comes on the
// following call. A stream that fails mid-line returns the error instead of the
// partial line, which a resumed stream reads whole.
func (l *LineReader) Next() (string, error) {
	if l.err != nil {
		return "", l.err
	}
	var kept []byte
	dropped := 0
	for {
		chunk, err := l.reader.ReadSlice('\n')
		if err == nil {
			// The line ends here; the newline itself is not content.
			chunk = chunk[:len(chunk)-1]
		}
		kept, dropped = appendWithinLimit(kept, dropped, chunk)
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if err != nil {
			return l.end(kept, dropped, err)
		}
		return finishLine(kept, dropped), nil
	}
}

// end records the stream's error and returns the line read so far only when
// the stream ended normally.
func (l *LineReader) end(kept []byte, dropped int, err error) (string, error) {
	l.err = err
	if !errors.Is(err, io.EOF) || (len(kept) == 0 && dropped == 0) {
		return "", err
	}
	return finishLine(kept, dropped), nil
}

func appendWithinLimit(kept []byte, dropped int, chunk []byte) ([]byte, int) {
	room := MaxLineBytes - len(kept)
	if room >= len(chunk) {
		return append(kept, chunk...), dropped
	}
	room = max(room, 0)
	return append(kept, chunk[:room]...), dropped + len(chunk) - room
}

func finishLine(kept []byte, dropped int) string {
	if dropped == 0 {
		return string(bytes.TrimSuffix(kept, []byte("\r")))
	}
	whole := trimPartialRune(kept)
	dropped += len(kept) - len(whole)
	return fmt.Sprintf("%s … [truncated %d bytes]", whole, dropped)
}

// trimPartialRune drops an incomplete UTF-8 sequence left at the end by a byte
// cut.
func trimPartialRune(b []byte) []byte {
	for i := len(b) - 1; i >= 0 && i >= len(b)-utf8.UTFMax; i-- {
		if utf8.RuneStart(b[i]) {
			if utf8.FullRune(b[i:]) {
				return b
			}
			return b[:i]
		}
	}
	return b
}

// SplitTimestamp separates the timestamp that kubelet prefixes to each line
// when Timestamps is requested. The prefix counts only when it parses as
// RFC3339Nano; it is returned in UTC so entries from nodes in other time zones
// compare consistently.
func SplitTimestamp(line string) (string, string) {
	space := strings.IndexByte(line, ' ')
	if space <= 0 {
		return "", line
	}
	parsed, err := time.Parse(time.RFC3339Nano, line[:space])
	if err != nil {
		return "", line
	}
	return parsed.UTC().Format(time.RFC3339Nano), line[space+1:]
}

// WireText returns text as a JSON encoder sends it: each byte that is not part
// of valid UTF-8 becomes U+FFFD.
func WireText(text string) string {
	if utf8.ValidString(text) {
		return text
	}
	var builder strings.Builder
	builder.Grow(len(text) + 2)
	for i := 0; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		if r == utf8.RuneError && size == 1 {
			builder.WriteRune(utf8.RuneError)
		} else {
			builder.WriteString(text[i : i+size])
		}
		i += size
	}
	return builder.String()
}
