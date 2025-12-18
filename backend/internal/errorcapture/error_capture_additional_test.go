package errorcapture

import (
	"strings"
	"testing"

	"bytes"
)

func TestCaptureIfInterestingSetsLastAndEmits(t *testing.T) {
	c := &Capture{}
	emitted := ""
	SetEventEmitter(func(msg string) { emitted = msg })
	t.Cleanup(func() {
		SetEventEmitter(nil)
	})

	c.captureIfInteresting("token has expired")

	if got := strings.TrimSpace(c.last()); !strings.Contains(got, "token has expired") {
		t.Fatalf("expected last error to be set, got %q", got)
	}
	if emitted == "" {
		t.Fatalf("expected event emitter to be called")
	}
}

func TestCapturedErrorFallsBackToRecent(t *testing.T) {
	orig := global
	global = &Capture{buffer: &bytes.Buffer{}}
	t.Cleanup(func() { global = orig })

	global.buffer.WriteString("INFO starting\nerror pulling config\nanother line\n")

	out := capturedError()
	if out != "error pulling config" {
		t.Fatalf("expected last error line, got %q", out)
	}
}
