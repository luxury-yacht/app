package containerlogsstream

import (
	"slices"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
)

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

// size returns the number of held entries and their line bytes.
func (p *pendingEntries) size() (int, int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.entries), p.bytes
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

// issueSet holds the current problem, if any, for each container target. It
// signals notify whenever the list changes. A nil set ignores updates.
type issueSet struct {
	mu     sync.Mutex
	issues map[string]containerlogs.TargetIssue
	notify chan struct{}
}

func newIssueSet() *issueSet {
	return &issueSet{issues: map[string]containerlogs.TargetIssue{}, notify: make(chan struct{}, 1)}
}

func (s *issueSet) set(key string, issue containerlogs.TargetIssue) {
	if s == nil {
		return
	}
	s.mu.Lock()
	previous, exists := s.issues[key]
	s.issues[key] = issue
	s.mu.Unlock()
	if !exists || previous != issue {
		s.signal()
	}
}

func (s *issueSet) clear(key string) {
	s.retain(func(candidate string) bool { return candidate != key })
}

// retain drops the issues of targets keep rejects.
func (s *issueSet) retain(keep func(key string) bool) {
	if s == nil {
		return
	}
	s.mu.Lock()
	changed := false
	for key := range s.issues {
		if !keep(key) {
			delete(s.issues, key)
			changed = true
		}
	}
	s.mu.Unlock()
	if changed {
		s.signal()
	}
}

// list returns the issues ordered by target key.
func (s *issueSet) list() []containerlogs.TargetIssue {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.issues))
	for key := range s.issues {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	issues := make([]containerlogs.TargetIssue, 0, len(keys))
	for _, key := range keys {
		issues = append(issues, s.issues[key])
	}
	return issues
}

func (s *issueSet) signal() {
	select {
	case s.notify <- struct{}{}:
	default:
	}
}
