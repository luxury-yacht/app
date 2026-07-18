package ingest

import "sync"

type bundleSinkEvent struct {
	bundle  Bundle
	deleted bool
}

// AsyncBundleSink preserves BundleSink delivery order while moving the wrapped
// callback off the source ProjectingStore's mutation goroutine. This is required
// for sinks that mutate a different ProjectingStore: source sinks run under the
// source store lock, so calling the second store directly would create a lock-order
// edge between otherwise independent stores.
type AsyncBundleSink struct {
	sink BundleSink

	mu       sync.Mutex
	ready    *sync.Cond
	queue    []bundleSinkEvent
	stopping bool
	done     chan struct{}
}

// NewAsyncBundleSink starts an ordered delivery worker for sink.
func NewAsyncBundleSink(sink BundleSink) *AsyncBundleSink {
	s := &AsyncBundleSink{sink: sink, done: make(chan struct{})}
	s.ready = sync.NewCond(&s.mu)
	go s.run()
	return s
}

func (s *AsyncBundleSink) UpsertBundle(bundle Bundle) {
	s.enqueue(bundleSinkEvent{bundle: bundle})
}

func (s *AsyncBundleSink) DeleteBundle(bundle Bundle) {
	s.enqueue(bundleSinkEvent{bundle: bundle, deleted: true})
}

func (s *AsyncBundleSink) enqueue(event bundleSinkEvent) {
	if s == nil || s.sink == nil {
		return
	}
	s.mu.Lock()
	if !s.stopping {
		s.queue = append(s.queue, event)
		s.ready.Signal()
	}
	s.mu.Unlock()
}

func (s *AsyncBundleSink) run() {
	defer close(s.done)
	for {
		s.mu.Lock()
		for len(s.queue) == 0 && !s.stopping {
			s.ready.Wait()
		}
		if len(s.queue) == 0 {
			s.mu.Unlock()
			return
		}
		event := s.queue[0]
		s.queue[0] = bundleSinkEvent{}
		s.queue = s.queue[1:]
		s.mu.Unlock()

		if event.deleted {
			s.sink.DeleteBundle(event.bundle)
		} else {
			s.sink.UpsertBundle(event.bundle)
		}
	}
}

// Stop rejects new events, drains events already accepted, and waits for the
// delivery worker to exit.
func (s *AsyncBundleSink) Stop() {
	if s == nil {
		return
	}
	s.mu.Lock()
	if !s.stopping {
		s.stopping = true
		s.ready.Broadcast()
	}
	s.mu.Unlock()
	<-s.done
}
