package storebench

// Prototype #3 (see docs/architecture/data-layer.md, "Provenance") — the WatchList
// watchdog + LIST fallback that gated the ingestion rewrite.
//
// WatchList (KEP-3157) streams a GVR's initial state as ADDED events terminated by
// a `k8s.io/initial-events-end: "true"` bookmark; client-go's reflector treats that
// terminal bookmark as "initial sync complete". A bookmark-stripping proxy (e.g.
// Teleport #64188) can drop that terminal bookmark, leaving a naive reflector to
// wait forever — the GVR never reaches readiness. The mitigation modeled here: a
// per-GVR watchdog that, if the terminal bookmark does not arrive before a deadline
// (or the stream closes without it), downgrades the GVR to a one-shot authoritative
// LIST and reaches readiness from that set instead.
//
// The load-bearing property this prototype proves: a GVR ALWAYS reaches readiness
// with its full object set — whether the terminal bookmark arrives or is stripped —
// so the ingestion path can never hang on a bookmark-stripping proxy.

type watchEventType int

const (
	eventAdded watchEventType = iota
	eventBookmark
)

// watchEvent is one event off a WatchList stream.
type watchEvent struct {
	typ              watchEventType
	obj              Object // populated for eventAdded
	initialEventsEnd bool   // for eventBookmark: the k8s.io/initial-events-end marker
}

type syncMode int

const (
	modeWatchList syncMode = iota
	modeListFallback
)

func (m syncMode) String() string {
	if m == modeListFallback {
		return "list-fallback"
	}
	return "watchlist"
}

// gvrSyncResult is the outcome of bringing one GVR to readiness.
type gvrSyncResult struct {
	mode    syncMode
	objects []Object
	ready   bool
	reason  string
}

// syncGVR brings one GVR to readiness over a WatchList stream, with the watchdog +
// LIST fallback. It collects ADDED events until the terminal initial-events-end
// bookmark, then reaches readiness via WatchList with the streamed set. If the
// deadline fires first, OR the stream closes without the terminal bookmark, it
// downgrades to the authoritative LIST and reaches readiness from that set (the
// partial streamed state is discarded — LIST is authoritative).
//
// Deterministic by construction: the caller supplies the watchdog deadline as a
// channel (production wires `time.After(timeout)`), so a test drives the timeout
// without real time.
func syncGVR(stream <-chan watchEvent, list func() []Object, deadline <-chan struct{}) gvrSyncResult {
	var collected []Object
	for {
		select {
		case ev, ok := <-stream:
			if !ok {
				// Stream ended before the terminal bookmark → the watch can never
				// signal sync completion. Fall back to the authoritative LIST.
				return gvrSyncResult{
					mode:    modeListFallback,
					objects: list(),
					ready:   true,
					reason:  "stream closed before initial-events-end bookmark",
				}
			}
			switch ev.typ {
			case eventAdded:
				collected = append(collected, ev.obj)
			case eventBookmark:
				if ev.initialEventsEnd {
					return gvrSyncResult{
						mode:    modeWatchList,
						objects: collected,
						ready:   true,
						reason:  "initial-events-end bookmark received",
					}
				}
				// A non-terminal bookmark is just an RV checkpoint — keep streaming.
			}
		case <-deadline:
			// The watchdog fired before the terminal bookmark arrived (a stripping
			// proxy, a stalled watch). Downgrade to the authoritative LIST.
			return gvrSyncResult{
				mode:    modeListFallback,
				objects: list(),
				ready:   true,
				reason:  "watchdog deadline before initial-events-end bookmark",
			}
		}
	}
}
