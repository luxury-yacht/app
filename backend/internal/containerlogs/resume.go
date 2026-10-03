package containerlogs

import (
	"hash/fnv"
	"time"
)

const (
	// ReplayIdle is how long a replay may go quiet at the resume timestamp
	// before its held lines are released. A replay re-sends existing history
	// back-to-back, so a gap this long means the group has fully arrived.
	ReplayIdle = 250 * time.Millisecond
	// ReplayHoldLimit caps how long any replayed line is held.
	ReplayHoldLimit = time.Second
	// replayHoldBytes caps the text held while matching.
	replayHoldBytes = 2 * 1024 * 1024
)

// ResumeCursor records where a follower stopped: the last log timestamp it
// delivered and hashes of the lines delivered at that timestamp, in order.
type ResumeCursor struct {
	at  time.Time
	run []uint64
}

func (c ResumeCursor) IsZero() bool { return c.at.IsZero() }

// Since is the time to resume from. Kubernetes applies it at second precision,
// so a resume re-reads up to a second of lines, which the tracker filters out.
func (c ResumeCursor) Since() time.Time { return c.at }

// Clone returns a cursor that shares no state with c.
func (c ResumeCursor) Clone() ResumeCursor {
	return ResumeCursor{at: c.at, run: append([]uint64(nil), c.run...)}
}

// Observe records a line delivered without a tracker, such as an initial read.
func (c *ResumeCursor) Observe(at time.Time, text string) {
	if !at.IsZero() {
		c.observe(at, hashLine(text))
	}
}

func (c *ResumeCursor) observe(at time.Time, hash uint64) {
	switch {
	case at.After(c.at):
		c.at = at
		c.run = []uint64{hash}
	case at.Equal(c.at):
		c.run = append(c.run, hash)
	}
}

// LineTracker filters one opened log stream against a follower's resume cursor
// and keeps that cursor current. It never drops a line the follower has not
// delivered: when the replay cannot be placed exactly it releases lines, which
// may repeat already-delivered ones.
//
// A stream opened with no resume point passes every line. A resumed stream
// skips lines older than the cursor and holds lines at the cursor timestamp
// until the earliest occurrence of the cursor's run is found (skip through it),
// the group ends (a later timestamp or the stream end), it goes quiet for
// ReplayIdle, ReplayHoldLimit passes, or the held text reaches its cap.
type LineTracker[T any] struct {
	cursor    *ResumeCursor
	resolved  bool
	at        time.Time
	run       []uint64
	failure   []int
	matched   int
	group     []uint64
	held      []T
	heldBytes int
	firstHeld time.Time
	lastHeld  time.Time
}

// NewLineTracker tracks a stream that was opened from cursor (resuming when the
// cursor is set). The cursor is updated in place.
func NewLineTracker[T any](cursor *ResumeCursor) *LineTracker[T] {
	tracker := &LineTracker[T]{cursor: cursor}
	if cursor.IsZero() || len(cursor.run) == 0 {
		tracker.resolved = true
		return tracker
	}
	tracker.at = cursor.at
	tracker.run = append([]uint64(nil), cursor.run...)
	tracker.failure = prefixFunction(tracker.run)
	return tracker
}

// Offer passes the next line of the stream and returns the items to deliver
// now. A zero at means the line had no timestamp; such lines cannot be placed
// and are delivered without touching the cursor.
func (t *LineTracker[T]) Offer(at time.Time, text string, item T, now time.Time) []T {
	if at.IsZero() {
		return []T{item}
	}
	hash := hashLine(text)
	if t.resolved {
		t.cursor.observe(at, hash)
		return []T{item}
	}
	switch {
	case at.Before(t.at):
		return nil
	case at.After(t.at):
		released := t.release()
		t.cursor.observe(at, hash)
		return append(released, item)
	}
	return t.hold(hash, len(text), item, now)
}

func (t *LineTracker[T]) hold(hash uint64, size int, item T, now time.Time) []T {
	t.group = append(t.group, hash)
	if len(t.held) == 0 {
		t.firstHeld = now
	}
	t.lastHeld = now
	t.held = append(t.held, item)
	t.heldBytes += size
	if t.advance(hash) {
		// Everything held so far is at or before the delivered run.
		t.held = nil
		t.resolve()
		return nil
	}
	if t.heldBytes >= replayHoldBytes {
		return t.release()
	}
	return nil
}

// Deadline reports when held lines must be released if nothing else arrives.
func (t *LineTracker[T]) Deadline() (time.Time, bool) {
	if t.resolved || len(t.held) == 0 {
		return time.Time{}, false
	}
	idle := t.lastHeld.Add(ReplayIdle)
	limit := t.firstHeld.Add(ReplayHoldLimit)
	if limit.Before(idle) {
		return limit, true
	}
	return idle, true
}

// Expire releases held lines once their deadline has passed.
func (t *LineTracker[T]) Expire(now time.Time) []T {
	if deadline, ok := t.Deadline(); ok && !now.Before(deadline) {
		return t.release()
	}
	return nil
}

// Finish releases held lines when the stream ends.
func (t *LineTracker[T]) Finish() []T {
	if t.resolved {
		return nil
	}
	return t.release()
}

func (t *LineTracker[T]) release() []T {
	released := t.held
	t.held = nil
	t.resolve()
	return released
}

// resolve ends matching. Every line of the resume group seen in this stream,
// delivered or skipped, now forms the cursor's run, since a later replay starts
// from the group's first line again.
func (t *LineTracker[T]) resolve() {
	t.resolved = true
	if len(t.group) > 0 {
		t.cursor.at = t.at
		t.cursor.run = append([]uint64(nil), t.group...)
	}
}

func (t *LineTracker[T]) advance(hash uint64) bool {
	for t.matched > 0 && hash != t.run[t.matched] {
		t.matched = t.failure[t.matched-1]
	}
	if hash == t.run[t.matched] {
		t.matched++
	}
	return t.matched == len(t.run)
}

// prefixFunction is the Knuth-Morris-Pratt failure table for run.
func prefixFunction(run []uint64) []int {
	failure := make([]int, len(run))
	for i := 1; i < len(run); i++ {
		k := failure[i-1]
		for k > 0 && run[i] != run[k] {
			k = failure[k-1]
		}
		if run[i] == run[k] {
			k++
		}
		failure[i] = k
	}
	return failure
}

func hashLine(text string) uint64 {
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(text))
	return hasher.Sum64()
}
