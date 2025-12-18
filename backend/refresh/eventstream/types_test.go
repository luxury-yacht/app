package eventstream

import "testing"

func TestNoopLoggerMethods(t *testing.T) {
	logger := noopLogger{}
	logger.Debug("debug")
	logger.Info("info")
	logger.Warn("warn")
	logger.Error("error")
}

func TestSubscriptionCloseIdempotent(t *testing.T) {
	sub := &subscription{ch: make(chan Entry)}
	sub.Close()
	sub.Close()
	if _, ok := <-sub.ch; ok {
		t.Fatalf("expected channel to be closed")
	}
}
