package objectcatalog

import (
	"testing"
)

func TestSnapshotSortedKeys(t *testing.T) {
	if snapshotSortedKeys(nil) != nil {
		t.Fatalf("expected nil from nil input")
	}
	input := map[string]struct{}{"b": {}, "a": {}}
	out := snapshotSortedKeys(input)
	if len(out) != 2 || out[0] != "a" || out[1] != "b" {
		t.Fatalf("expected sorted keys, got %v", out)
	}
}

func TestBroadcastStreamingSendsReady(t *testing.T) {
	ch := make(chan StreamingUpdate, 2)
	ch <- StreamingUpdate{Ready: false} // stale signal to drain

	svc := &Service{
		streamSubscribers: map[int]chan StreamingUpdate{1: ch},
	}

	svc.broadcastStreaming(true)

	select {
	case update := <-ch:
		if !update.Ready {
			t.Fatalf("expected ready update, got %v", update)
		}
	default:
		t.Fatalf("expected update to be sent")
	}
}
