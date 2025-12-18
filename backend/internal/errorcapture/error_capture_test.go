package errorcapture

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestCaptureIfInterestingStoresLastAndEmits(t *testing.T) {
	c := &Capture{buffer: &bytes.Buffer{}}
	global = c
	defer func() {
		global = nil
		eventEmitter = nil
	}()

	var emitted []string
	SetEventEmitter(func(msg string) {
		emitted = append(emitted, msg)
	})

	c.captureIfInteresting("token expired while authenticating\n")

	if last := c.last(); last != "token expired while authenticating" {
		t.Fatalf("expected last error to be stored, got %q", last)
	}
	if len(emitted) != 1 {
		t.Fatalf("expected event emitter to be invoked once, got %d", len(emitted))
	}
	if emitted[0] != "token expired while authenticating" {
		t.Fatalf("expected emitted message to be trimmed, got %q", emitted[0])
	}

	// Non-interesting lines should not overwrite last error.
	c.captureIfInteresting("INFO: everything healthy")
	if last := c.last(); last != "token expired while authenticating" {
		t.Fatalf("expected last error unchanged for non-interesting output, got %q", last)
	}
}

func TestCapturedErrorPrefersLastAndClears(t *testing.T) {
	c := &Capture{buffer: &bytes.Buffer{}}
	c.lastError = "forbidden: token expired"
	global = c
	defer func() { global = nil }()

	if got := capturedError(); got != "forbidden: token expired" {
		t.Fatalf("expected capturedError to return last message, got %q", got)
	}
	if got := capturedError(); got != "" {
		t.Fatalf("expected last error to be cleared after retrieval, got %q", got)
	}
}

func TestCapturedErrorScansRecentBuffer(t *testing.T) {
	c := &Capture{buffer: bytes.NewBufferString("info message\nfailed to refresh token\n")} // newline terminated
	global = c
	defer func() { global = nil }()

	if got := capturedError(); got != "failed to refresh token" {
		t.Fatalf("expected capturedError to scan recent buffer, got %q", got)
	}
}

func TestEnhanceAugmentsError(t *testing.T) {
	c := &Capture{buffer: &bytes.Buffer{}}
	global = c
	defer func() { global = nil }()

	c.captureIfInteresting("unauthorized for cluster foo")
	err := Enhance(errors.New("refresh failed"))
	if err == nil {
		t.Fatalf("expected error to be returned")
	}

	if !strings.Contains(err.Error(), "unauthorized for cluster foo") {
		t.Fatalf("expected enhanced error to contain captured message, got %q", err.Error())
	}
}

func TestEnhanceNoAugmentWhenNoExtra(t *testing.T) {
	global = &Capture{buffer: &bytes.Buffer{}}
	defer func() { global = nil }()

	orig := errors.New("plain error")
	if got := Enhance(orig); got != orig {
		t.Fatalf("expected Enhance to return original error when no extra context")
	}
}

func TestEmitToLogSinkClassifiesLevels(t *testing.T) {
	c := &Capture{}
	global = c
	defer func() {
		global = nil
		logSink = nil
	}()

	var logs []string
	SetLogSink(func(level, message string) {
		logs = append(logs, level+":"+message)
	})

	c.emitToLogSink([]byte("E1010 10:00:00 error occurred\nW1010 warning issued\nI info line\n"))

	expected := []string{
		"error:E1010 10:00:00 error occurred",
		"warn:W1010 warning issued",
		"info:I info line",
	}
	if len(logs) != len(expected) {
		t.Fatalf("expected %d log entries, got %d", len(expected), len(logs))
	}
	for i, want := range expected {
		if logs[i] != want {
			t.Fatalf("log entry %d mismatch: got %q want %q", i, logs[i], want)
		}
	}
}
