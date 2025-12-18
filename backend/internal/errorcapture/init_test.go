package errorcapture

import "testing"

func TestInitIsIdempotent(t *testing.T) {
	Init()
	Init() // second call should be harmless

	if got := capturedError(); got != "" {
		t.Fatalf("expected no captured error after init, got %q", got)
	}
}
