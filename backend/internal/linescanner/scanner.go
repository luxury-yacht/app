package linescanner

import (
	"bufio"
	"io"
)

const (
	// MaxTokenSize lifts bufio.Scanner's default 64 KiB token cap so large
	// single-line JSON logs and stack traces do not abort log delivery.
	MaxTokenSize = 1024 * 1024
	initialBuf   = 64 * 1024
)

// New returns a Scanner configured for larger log lines.
func New(reader io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, initialBuf), MaxTokenSize)
	return scanner
}
