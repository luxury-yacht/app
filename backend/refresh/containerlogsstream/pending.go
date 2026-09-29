package containerlogsstream

import "sync"

// entrySink receives entries from followers. It never blocks: a follower must
// keep reading its stream even when the client is slow.
type entrySink interface {
	add(Entry)
}

// pendingEntries holds every follower's entries until the session sends them.
// It is bounded; once full, new entries are dropped and counted so the client
// can be told lines were lost.
type pendingEntries struct {
	mu           sync.Mutex
	entries      []Entry
	bytes        int
	dropped      int
	limitEntries int
	limitBytes   int
	notify       chan struct{}
}

func newPendingEntries(limitEntries, limitBytes int) *pendingEntries {
	return &pendingEntries{limitEntries: limitEntries, limitBytes: limitBytes, notify: make(chan struct{}, 1)}
}

func (p *pendingEntries) add(entry Entry) {
	size := len(entry.Line)
	p.mu.Lock()
	if len(p.entries) >= p.limitEntries || p.bytes+size > p.limitBytes {
		p.dropped++
	} else {
		p.entries = append(p.entries, entry)
		p.bytes += size
	}
	p.mu.Unlock()
	select {
	case p.notify <- struct{}{}:
	default:
	}
}

// take returns and clears the held entries and the number dropped since the
// last take.
func (p *pendingEntries) take() ([]Entry, int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	entries, dropped := p.entries, p.dropped
	p.entries, p.bytes, p.dropped = nil, 0, 0
	return entries, dropped
}

func (p *pendingEntries) size() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.entries)
}

// snapshotWait tracks the followers started for a session's first snapshot.
// It closes done once every one of them has delivered its history, and ignores
// followers started after the initial set is sealed.
type snapshotWait struct {
	mu       sync.Mutex
	expected map[string]struct{}
	sealed   bool
	done     chan struct{}
}

func newSnapshotWait() *snapshotWait {
	return &snapshotWait{expected: map[string]struct{}{}, done: make(chan struct{})}
}

// expect registers an initial follower and returns its caught-up callback.
func (w *snapshotWait) expect(key string) func() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.sealed {
		return func() {}
	}
	w.expected[key] = struct{}{}
	var once sync.Once
	return func() { once.Do(func() { w.caughtUp(key) }) }
}

// seal ends registration; the snapshot can complete once the registered
// followers catch up.
func (w *snapshotWait) seal() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.sealed = true
	w.closeIfCompleteLocked()
}

func (w *snapshotWait) caughtUp(key string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.expected, key)
	w.closeIfCompleteLocked()
}

func (w *snapshotWait) closeIfCompleteLocked() {
	if !w.sealed || len(w.expected) > 0 {
		return
	}
	select {
	case <-w.done:
	default:
		close(w.done)
	}
}
