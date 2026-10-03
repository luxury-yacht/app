package containerlogsstream

import (
	"context"
	"errors"
	"io"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// lineRecord is what a session remembers of a line it sent: enough to tell
// which lines the client's buffer still holds.
type lineRecord struct {
	timestamp string
	size      int
	pod       string
}

func recordOf(entry Entry) lineRecord {
	return lineRecord{timestamp: entry.Timestamp, size: len(entry.Line), pod: entry.Pod}
}

func newRecordWindow(maxEntries, maxBytes int) *containerlogs.NewestWindow[lineRecord] {
	return containerlogs.NewNewestWindow(maxEntries, maxBytes,
		func(record lineRecord) string { return record.timestamp },
		func(record lineRecord) int { return record.size })
}

// oldestHeld is the time of the oldest line a full buffer keeps, or zero while
// the buffer may still have room. A line older than it would be evicted on
// arrival.
func oldestHeld(kept []lineRecord, leftOut, maxEntries int) time.Time {
	if len(kept) == 0 || (leftOut == 0 && len(kept) < maxEntries) {
		return time.Time{}
	}
	return parseLogTimestamp(kept[0].timestamp)
}

// sentLines follows the newest lines a session has sent. The client's buffer
// holds them, or newer ones and lines from before a resume, so its oldest line
// is never older than theirs.
type sentLines struct {
	maxEntries int
	maxBytes   int
	mu         sync.Mutex
	window     *containerlogs.NewestWindow[lineRecord]
}

func newSentLines(maxEntries, maxBytes int) *sentLines {
	return &sentLines{maxEntries: maxEntries, maxBytes: maxBytes, window: newRecordWindow(maxEntries, maxBytes)}
}

func (s *sentLines) add(entries []Entry) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, entry := range entries {
		s.window.Add(recordOf(entry))
	}
}

// dropPod forgets the lines of a pod the client dropped. The client then has
// room again, so nothing counts as evicted until it fills up.
func (s *sentLines) dropPod(pod string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	kept, _ := s.window.Kept()
	s.window = newRecordWindow(s.maxEntries, s.maxBytes)
	for _, record := range kept {
		if record.pod != pod {
			s.window.Add(record)
		}
	}
}

// records returns the sent lines the client still holds and how many it has
// evicted.
func (s *sentLines) records() ([]lineRecord, int) {
	if s == nil {
		return nil, 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.window.Kept()
}

// floor is the time of the oldest line the client's full buffer keeps, or zero
// while it may have room; no read needs anything older.
func (s *sentLines) floor() time.Time {
	if s == nil {
		return time.Time{}
	}
	kept, leftOut := s.records()
	return oldestHeld(kept, leftOut, s.maxEntries)
}

// historyRounds plans the history reads of a session's containers. The first
// containers form the first round; containers that start later are gathered
// into further rounds, so a burst of new pods shares one buffer of history too.
type historyRounds struct {
	maxEntries  int
	maxBytes    int
	sent        *sentLines
	gather      time.Duration
	decideAfter time.Duration
	mu          sync.Mutex
	// open is the round taking members; the first round is open from the start.
	open *historyRound
}

func newHistoryRounds(maxEntries, maxBytes int, sent *sentLines, gather, decideAfter time.Duration) *historyRounds {
	rounds := &historyRounds{maxEntries: maxEntries, maxBytes: maxBytes, sent: sent, gather: gather, decideAfter: decideAfter}
	rounds.open = rounds.newRound()
	return rounds
}

func (h *historyRounds) newRound() *historyRound {
	return &historyRound{
		maxEntries: h.maxEntries, maxBytes: h.maxBytes, sent: h.sent,
		sealed: make(chan struct{}), decided: make(chan struct{}), waiting: map[string]struct{}{},
	}
}

// join adds a container without a resume point to the round now gathering. A
// container that starts after the first round was sealed opens a new round,
// sealed once the gathering time has passed. A nil plan adds nothing.
func (h *historyRounds) join(key string) *historyRound {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.open == nil {
		round := h.newRound()
		h.open = round
		time.AfterFunc(h.gather, func() { h.seal(round) })
	}
	h.open.add(key)
	return h.open
}

// sealFirst seals the round of the session's first containers.
func (h *historyRounds) sealFirst() {
	if h == nil {
		return
	}
	h.mu.Lock()
	round := h.open
	h.mu.Unlock()
	if round != nil {
		h.seal(round)
	}
}

func (h *historyRounds) seal(round *historyRound) {
	h.mu.Lock()
	if h.open == round {
		h.open = nil
	}
	h.mu.Unlock()
	round.seal(h.decideAfter)
}

// historyRound reads the history of one group of containers in two steps, so
// the group downloads about one buffer of history instead of one per
// container.
//
// Each container first reads a share of the buffer, in lines and in bytes,
// from the floor: the oldest line the client's buffer keeps, when it is full.
// A read keeps only the newest lines that fit its bytes, and the round keeps
// only each line's time and size, so a round holds about two buffers of
// history however large the containers' logs are. Once every share has
// arrived, or the decision time has passed, the round finds the cut-off: the
// oldest line the client can hold among what it already holds and everything
// read. A container can hold more of the newest lines only if its share came
// back full (every line it asked for, or cut short by its bytes) and its oldest
// line is after the cut-off; it alone reads again, from the cut-off, keeping at
// most one buffer. The cut-off comes from a subset of the client's lines, so
// it is never later than the true one and every line the client can hold is
// read.
type historyRound struct {
	maxEntries int
	maxBytes   int
	sent       *sentLines
	sealed     chan struct{}
	decided    chan struct{}

	mu sync.Mutex
	// waiting holds the members that have not reported yet.
	waiting map[string]struct{}
	// reads holds only the time and size of each line the members read, all
	// the cut-off needs.
	reads      []lineRecord
	isSealed   bool
	isDecided  bool
	share      int
	byteShare  int
	floor      time.Time
	cutoff     time.Time
	decideTime *time.Timer
}

func (p *historyRound) add(key string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.waiting[key] = struct{}{}
}

// seal ends membership, sets the share (twice the buffer, in lines and in
// bytes, split across the members) and the floor. With fewer than three
// members the share is no smaller than the buffer, so each member follows
// directly from the floor.
func (p *historyRound) seal(decideAfter time.Duration) {
	floor := p.sent.floor()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.isSealed = true
	p.floor = floor
	if count := len(p.waiting); count > 0 {
		if share := (2*p.maxEntries + count - 1) / count; share < p.maxEntries {
			p.share = share
			p.byteShare = (2*p.maxBytes + count - 1) / count
		}
	}
	close(p.sealed)
	if p.share == 0 {
		p.decideLocked()
		return
	}
	p.decideTime = time.AfterFunc(decideAfter, p.decide)
}

// historyShare is what one member of a round reads first: at most lines lines
// whose sizes total at most bytes, from the floor. Zero lines means the member
// follows directly from the floor.
type historyShare struct {
	lines int
	bytes int
	floor time.Time
}

// shareFor waits for the round to be sealed and returns the member's share;
// false means the session ended first.
func (p *historyRound) shareFor(ctx context.Context) (historyShare, bool) {
	select {
	case <-p.sealed:
		return historyShare{lines: p.share, bytes: p.byteShare, floor: p.floor}, true
	case <-ctx.Done():
		return historyShare{}, false
	}
}

// report records a member's first read and waits for the cut-off, which is
// zero while the client's buffer can hold everything.
func (p *historyRound) report(ctx context.Context, key string, read []Entry) (time.Time, bool) {
	p.mu.Lock()
	if !p.isDecided {
		for _, entry := range read {
			p.reads = append(p.reads, recordOf(entry))
		}
		p.removeLocked(key)
	}
	p.mu.Unlock()
	select {
	case <-p.decided:
		return p.cutoff, true
	case <-ctx.Done():
		return time.Time{}, false
	}
}

// withdraw removes a member that will not report, so the decision does not
// wait for it.
func (p *historyRound) withdraw(key string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.removeLocked(key)
}

func (p *historyRound) removeLocked(key string) {
	delete(p.waiting, key)
	if p.isSealed && len(p.waiting) == 0 {
		p.decideLocked()
	}
}

func (p *historyRound) decide() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.decideLocked()
}

func (p *historyRound) decideLocked() {
	if p.isDecided {
		return
	}
	p.isDecided = true
	if p.decideTime != nil {
		p.decideTime.Stop()
	}
	held, evicted := p.sent.records()
	p.cutoff = newestCutoff(held, evicted, p.reads, p.maxEntries, p.maxBytes)
	p.reads = nil
	close(p.decided)
}

// newestCutoff is the time of the oldest line the client can hold among the
// lines it holds and the reads, or zero while it can hold them all.
func newestCutoff(held []lineRecord, evicted int, reads []lineRecord, maxEntries, maxBytes int) time.Time {
	window := newRecordWindow(maxEntries, maxBytes)
	for _, record := range held {
		window.Add(record)
	}
	for _, record := range reads {
		window.Add(record)
	}
	kept, leftOut := window.Take()
	return oldestHeld(kept, leftOut+evicted, maxEntries)
}

// readsFurther reports whether a first read may have left out lines newer than
// the cut-off: it came back full (its share of lines, or cut short by its share
// of bytes) and its oldest line is after the cut-off, or nothing was cut off.
func readsFurther(read []Entry, full bool, cutoff time.Time) bool {
	if !full {
		return false
	}
	if len(read) == 0 {
		// A byte share smaller than the newest line kept nothing.
		return true
	}
	oldest := parseLogTimestamp(read[0].Timestamp)
	return !oldest.IsZero() && (cutoff.IsZero() || oldest.After(cutoff))
}

// readHistory reads a container's last tail lines, only those from since's
// second on when since is set, without following. The whole read is bounded by
// the response timeout, since a plain read that stalls would never end.
func (s *Streamer) readHistory(ctx context.Context, target containerTarget, tail, maxBytes int, since time.Time) ([]Entry, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, s.responseTimeout)
	defer cancel()
	tailLines := int64(tail)
	options := &corev1.PodLogOptions{Container: target.container, Timestamps: true, TailLines: &tailLines}
	if !since.IsZero() {
		sinceTime := metav1.NewTime(since)
		options.SinceTime = &sinceTime
	}
	stream, err := s.client.CoreV1().Pods(target.namespace).GetLogs(target.pod, options).Stream(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = stream.Close() }()
	window := historyWindow{maxBytes: maxBytes}
	reader := containerlogs.NewLineReader(stream)
	for {
		line, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return window.kept(), window.leftOut, nil
		}
		if err != nil {
			return nil, false, err
		}
		window.add(target.entry(line))
	}
}

// historyWindow keeps the newest lines of a read, which arrive oldest first,
// whose sizes fit maxBytes (no limit when it is not positive), so a read never
// holds more of a container's history than it may deliver.
type historyWindow struct {
	maxBytes int
	lines    []Entry
	start    int
	bytes    int
	leftOut  bool
}

func (w *historyWindow) add(entry Entry) {
	w.lines = append(w.lines, entry)
	w.bytes += len(entry.Line)
	for w.maxBytes > 0 && w.bytes > w.maxBytes && w.start < len(w.lines) {
		w.bytes -= len(w.lines[w.start].Line)
		w.lines[w.start] = Entry{} // releases the line's text
		w.start++
		w.leftOut = true
	}
	// Reuse the dropped front once it is half the slice, so the slice grows with
	// the lines kept rather than the lines read.
	if w.start > 0 && 2*w.start >= len(w.lines) {
		kept := copy(w.lines, w.lines[w.start:])
		clear(w.lines[kept:])
		w.lines = w.lines[:kept]
		w.start = 0
	}
}

func (w *historyWindow) kept() []Entry {
	return w.lines[w.start:]
}
