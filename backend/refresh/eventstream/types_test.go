package eventstream

import "testing"

func TestSubscriptionCloseIdempotent(t *testing.T) {
	sub := &subscription{ch: make(chan StreamEvent)}
	sub.Close()
	sub.Close()
	if _, ok := <-sub.ch; ok {
		t.Fatalf("expected channel to be closed")
	}
}
