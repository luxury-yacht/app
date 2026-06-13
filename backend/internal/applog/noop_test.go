package applog

import "testing"

func TestNoopIsNonNilAndDiscards(t *testing.T) {
	if Noop == nil {
		t.Fatal("Noop must be a non-nil logger so callers can drop nil-guards")
	}

	// Must not panic at any level.
	Noop.Debug("x", "Source")
	Noop.Info("x", "Source")
	Noop.Warn("x", "Source")
	Noop.Error("x", "Source")
}
