package errorcapture

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestInitIsIdempotent(t *testing.T) {
	Init()
	Init() // second call should be harmless

	if got := capturedError(); got != "" {
		t.Fatalf("expected no captured error after init, got %q", got)
	}
}

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

func TestCaptureIfInterestingIgnoresTokenSubstrings(t *testing.T) {
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

	c.captureIfInteresting(`I0102 19:05:24.494180   77320 reflector.go:446] "Caches populated" type="generators.external-secrets.io/v1alpha1, Resource=cloudsmithaccesstokens"`)

	if last := c.last(); last != "" {
		t.Fatalf("expected last error to remain empty, got %q", last)
	}
	if len(emitted) != 0 {
		t.Fatalf("expected no emitted events, got %d", len(emitted))
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

func TestCaptureStartAndEnhance(t *testing.T) {
	originalStderr := os.Stderr
	defer func() { os.Stderr = originalStderr }()

	c := &Capture{buffer: &bytes.Buffer{}}
	global = c

	var sinkLevels []string
	SetLogSink(func(level string, message string) {
		sinkLevels = append(sinkLevels, fmt.Sprintf("%s:%s", level, message))
	})
	defer SetLogSink(nil)

	c.start()
	require.True(t, c.capturing, "capture should start capturing stderr")

	_, err := c.pipeWriter.Write([]byte("E token expired\n"))
	require.NoError(t, err)

	Wait()

	enhanced := Enhance(fmt.Errorf("original error"))
	require.Error(t, enhanced)
	require.Contains(t, enhanced.Error(), "token expired")
	require.NotEmpty(t, sinkLevels, "log sink should record emitted chunk")

	// cleanup the pipe to stop the goroutine
	_ = c.pipeWriter.Close()
	_ = c.pipeReader.Close()
	global = nil

	time.Sleep(10 * time.Millisecond)
}

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
