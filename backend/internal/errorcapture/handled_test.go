package errorcapture

import (
	"errors"
	"fmt"
	"testing"
)

func TestTelemetryHandledMarkerSurvivesWrapping(t *testing.T) {
	cause := errors.New("boom")
	marked := MarkTelemetryHandled(cause)
	wrapped := fmt.Errorf("fetch failed: %w", marked)

	if !IsTelemetryHandled(wrapped) {
		t.Fatal("expected marker to survive ordinary error wrapping")
	}
	if !errors.Is(wrapped, cause) {
		t.Fatal("expected marker to preserve the original cause")
	}
	if wrapped.Error() != "fetch failed: boom" {
		t.Fatalf("unexpected rendered error: %q", wrapped.Error())
	}
}

func TestTelemetryHandledMarkerIsIdempotentAndNilSafe(t *testing.T) {
	if MarkTelemetryHandled(nil) != nil {
		t.Fatal("expected nil to remain nil")
	}
	if IsTelemetryHandled(nil) {
		t.Fatal("nil must not be marked handled")
	}

	cause := errors.New("boom")
	marked := MarkTelemetryHandled(cause)
	if again := MarkTelemetryHandled(marked); again != marked {
		t.Fatal("marking an already handled error must be idempotent")
	}
}
