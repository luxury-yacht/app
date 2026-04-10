package linescanner

import (
	"strings"
	"testing"
)

func TestNewHandlesLinesLargerThanDefaultScannerLimit(t *testing.T) {
	longLine := strings.Repeat("x", 80*1024)
	scanner := New(strings.NewReader(longLine + "\n"))

	if !scanner.Scan() {
		t.Fatalf("expected scan to succeed, got err=%v", scanner.Err())
	}
	if got := scanner.Text(); got != longLine {
		t.Fatalf("unexpected line length: got %d want %d", len(got), len(longLine))
	}
	if scanner.Scan() {
		t.Fatal("expected single line input")
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("expected no scanner error, got %v", err)
	}
}
