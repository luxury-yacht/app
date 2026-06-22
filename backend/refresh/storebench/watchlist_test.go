package storebench

import (
	"fmt"
	"testing"
)

func wlObjects(n int) []Object {
	out := make([]Object, n)
	for i := 0; i < n; i++ {
		out[i] = Object{UID: fmt.Sprintf("u%03d", i), Namespace: "default", Name: fmt.Sprintf("o%03d", i), Status: "Running"}
	}
	return out
}

// feedClosed returns a stream pre-loaded with `events` and then closed.
func feedClosed(events []watchEvent) <-chan watchEvent {
	ch := make(chan watchEvent, len(events))
	for _, e := range events {
		ch <- e
	}
	close(ch)
	return ch
}

func addedEvents(objs []Object) []watchEvent {
	out := make([]watchEvent, 0, len(objs)+1)
	for _, o := range objs {
		out = append(out, watchEvent{typ: eventAdded, obj: o})
	}
	return out
}

// TestWatchListReachesReadinessViaBookmark is the happy path: ADDED events
// terminated by the initial-events-end bookmark bring the GVR to readiness via
// WatchList with the full streamed set, and the LIST fallback never runs.
func TestWatchListReachesReadinessViaBookmark(t *testing.T) {
	objs := wlObjects(50)
	events := append(addedEvents(objs), watchEvent{typ: eventBookmark, initialEventsEnd: true})

	never := make(chan struct{})
	res := syncGVR(feedClosed(events), func() []Object {
		t.Fatal("LIST fallback must not run when the terminal bookmark arrives")
		return nil
	}, never)

	if res.mode != modeWatchList {
		t.Fatalf("mode = %s, want watchlist (%s)", res.mode, res.reason)
	}
	if !res.ready || len(res.objects) != len(objs) {
		t.Fatalf("ready=%v objects=%d, want ready with %d", res.ready, len(res.objects), len(objs))
	}
}

// TestBookmarkStrippedFallsBackToList is the load-bearing fault injection (the
// Teleport #64188 hang): a stripping proxy drops the terminal bookmark. The
// watchdog must STILL bring the GVR to readiness via the authoritative LIST —
// never hang — covering both "stream closes without the bookmark" and "stream
// stalls and the watchdog deadline fires".
func TestBookmarkStrippedFallsBackToList(t *testing.T) {
	objs := wlObjects(50)

	t.Run("stream-closed-without-bookmark", func(t *testing.T) {
		never := make(chan struct{})
		listed := false
		res := syncGVR(feedClosed(addedEvents(objs)), func() []Object { listed = true; return objs }, never)
		if res.mode != modeListFallback || !listed || !res.ready || len(res.objects) != len(objs) {
			t.Fatalf("got mode=%s listed=%v ready=%v n=%d (%s); want list-fallback, listed, ready, %d",
				res.mode, listed, res.ready, len(res.objects), res.reason, len(objs))
		}
	})

	t.Run("stream-stalls-watchdog-fires", func(t *testing.T) {
		// Buffered ADDED events but the channel is NEVER closed and the terminal
		// bookmark never comes — the watch hangs. The watchdog deadline (closed)
		// must fire and force the LIST fallback.
		stream := make(chan watchEvent, len(objs))
		for _, o := range objs {
			stream <- watchEvent{typ: eventAdded, obj: o}
		}
		deadline := make(chan struct{})
		close(deadline)
		listed := false
		res := syncGVR(stream, func() []Object { listed = true; return objs }, deadline)
		if res.mode != modeListFallback || !listed || !res.ready || len(res.objects) != len(objs) {
			t.Fatalf("got mode=%s listed=%v ready=%v n=%d (%s); want list-fallback, listed, ready, %d",
				res.mode, listed, res.ready, len(res.objects), res.reason, len(objs))
		}
	})
}

// TestNonTerminalBookmarkDoesNotEndSync proves an RV-checkpoint bookmark (without
// the initial-events-end marker) is NOT mistaken for initial-sync completion.
func TestNonTerminalBookmarkDoesNotEndSync(t *testing.T) {
	objs := wlObjects(10)
	events := []watchEvent{
		{typ: eventAdded, obj: objs[0]},
		{typ: eventBookmark, initialEventsEnd: false}, // an RV checkpoint, NOT terminal
	}
	events = append(events, addedEvents(objs[1:])...)
	events = append(events, watchEvent{typ: eventBookmark, initialEventsEnd: true}) // terminal

	never := make(chan struct{})
	res := syncGVR(feedClosed(events), func() []Object { t.Fatal("must not fall back"); return nil }, never)
	if res.mode != modeWatchList || len(res.objects) != len(objs) {
		t.Fatalf("got mode=%s n=%d; want watchlist with %d (non-terminal bookmark must be ignored)",
			res.mode, len(res.objects), len(objs))
	}
}
