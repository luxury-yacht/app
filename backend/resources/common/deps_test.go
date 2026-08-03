/*
 * backend/resources/common/deps_test.go
 *
 * Tests for Shared dependency bundle for resource services.
 * - Covers Shared dependency bundle for resource services behavior and edge cases.
 */

package common

import (
	"context"
	"fmt"
	"net/url"
	"testing"
)

type testContextKey string

type recordingDepsLogger struct {
	level   string
	message string
	source  []string
}

type recordingStructuredDepsLogger struct {
	recordingDepsLogger
	cause error
}

func (l *recordingStructuredDepsLogger) ErrorWithCause(err error, message string, source ...string) {
	l.cause = err
	l.record("error", message, source...)
}

func (l *recordingDepsLogger) record(level, message string, source ...string) {
	l.level = level
	l.message = message
	l.source = source
}

func (l *recordingDepsLogger) Debug(message string, source ...string) {
	l.record("debug", message, source...)
}
func (l *recordingDepsLogger) Info(message string, source ...string) {
	l.record("info", message, source...)
}
func (l *recordingDepsLogger) Warn(message string, source ...string) {
	l.record("warn", message, source...)
}
func (l *recordingDepsLogger) Error(message string, source ...string) {
	l.record("error", message, source...)
}

// A cancelled read is an expected lifecycle event: the panel closed, the user
// navigated away, or the cluster disconnected. Logging it at ERROR forwards it
// to error reporting as though the app had failed.
func TestLogRequestFailureKeepsCancellationOffTheErrorPath(t *testing.T) {
	logger := &recordingDepsLogger{}
	deps := Dependencies{Logger: logger}

	// Shaped like a real client-go failure, which wraps the cause in url.Error.
	cancelled := &url.Error{
		Op:  "Get",
		URL: "https://example.test/apis/apps/v1/deployments/web",
		Err: context.Canceled,
	}

	deps.LogRequestFailure(cancelled, "Failed to get deployment default/web", "ResourceLoader")

	if logger.level != "debug" {
		t.Fatalf("expected cancellation at debug level, got %q (%s)", logger.level, logger.message)
	}
}

func TestLogRequestFailureReportsRealErrors(t *testing.T) {
	logger := &recordingDepsLogger{}
	deps := Dependencies{Logger: logger}

	deps.LogRequestFailure(fmt.Errorf("forbidden"), "Failed to get deployment default/web", "ResourceLoader")

	if logger.level != "error" {
		t.Fatalf("expected error level, got %q", logger.level)
	}
	want := "Failed to get deployment default/web: forbidden"
	if logger.message != want {
		t.Fatalf("expected %q, got %q", want, logger.message)
	}
	if len(logger.source) != 1 || logger.source[0] != "ResourceLoader" {
		t.Fatalf("expected source to be forwarded, got %v", logger.source)
	}
}

func TestLogRequestFailurePreservesOriginalErrorForStructuredLogger(t *testing.T) {
	logger := &recordingStructuredDepsLogger{}
	deps := Dependencies{Logger: logger}
	cause := fmt.Errorf("forbidden")

	deps.LogRequestFailure(cause, "Failed to get deployment default/web", "ResourceLoader")

	if logger.cause != cause {
		t.Fatalf("expected original cause to be forwarded, got %v", logger.cause)
	}
	if logger.message != "Failed to get deployment default/web" {
		t.Fatalf("expected operation to remain separate, got %q", logger.message)
	}
}

func TestLogRequestFailureToleratesNilLogger(t *testing.T) {
	deps := Dependencies{}

	deps.LogRequestFailure(fmt.Errorf("forbidden"), "Failed to get deployment default/web", "ResourceLoader")
}

func TestCloneWithContext(t *testing.T) {
	original := Dependencies{Context: context.Background()}
	newCtx := context.WithValue(context.Background(), testContextKey("k"), "v")

	clone := original.CloneWithContext(newCtx)
	if clone.Context != newCtx {
		t.Fatalf("expected context to be replaced")
	}
	if original.Context == newCtx {
		t.Fatalf("expected original context to remain unchanged")
	}
}
