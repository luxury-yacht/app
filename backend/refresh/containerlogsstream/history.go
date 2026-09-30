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

// historyPlan reads the history of a session's first containers in two steps,
// so a session following many containers downloads about one buffer of
// history instead of one buffer per container.
//
// Each container first reads a share of the buffer. Once every share has
// arrived, or the decision time has passed, the plan finds the cut-off: the
// oldest line the client can hold among everything read. A container can hold
// more of the newest lines only if its share came back full and its oldest line
// is after the cut-off; it alone reads again, from the cut-off. The cut-off
// comes from a subset of the lines, so it is never later than the true one and
// every line the client can hold is read.
type historyPlan struct {
	maxEntries int
	maxBytes   int
	sealed     chan struct{}
	decided    chan struct{}

	mu sync.Mutex
	// waiting holds the registered targets that have not reported yet.
	waiting    map[string]struct{}
	reads      [][]Entry
	isSealed   bool
	isDecided  bool
	share      int
	cutoff     time.Time
	decideTime *time.Timer
}

func newHistoryPlan(maxEntries, maxBytes int) *historyPlan {
	return &historyPlan{
		maxEntries: maxEntries, maxBytes: maxBytes,
		sealed: make(chan struct{}), decided: make(chan struct{}), waiting: map[string]struct{}{},
	}
}

// register adds one of the session's first targets; once the plan is sealed
// no more are added. A nil plan registers nothing.
func (p *historyPlan) register(key string) bool {
	if p == nil {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.isSealed {
		return false
	}
	p.waiting[key] = struct{}{}
	return true
}

// seal ends registration and sets the share: twice the buffer, split across
// the targets. With fewer than three targets the share is no smaller than the
// buffer, so they read their history by following, as before.
func (p *historyPlan) seal(decideAfter time.Duration) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.isSealed = true
	if count := len(p.waiting); count > 0 {
		if share := (2*p.maxEntries + count - 1) / count; share < p.maxEntries {
			p.share = share
		}
	}
	close(p.sealed)
	if p.share == 0 {
		p.decideLocked()
		return
	}
	p.decideTime = time.AfterFunc(decideAfter, p.decide)
}

// shareFor waits for the plan to be sealed and returns the target's share, or
// false when the target reads its history by following.
func (p *historyPlan) shareFor(ctx context.Context) (int, bool) {
	select {
	case <-p.sealed:
		return p.share, p.share > 0
	case <-ctx.Done():
		return 0, false
	}
}

// report records a target's first read and waits for the cut-off, which is
// zero when every line read fits the buffer.
func (p *historyPlan) report(ctx context.Context, key string, read []Entry) (time.Time, bool) {
	p.mu.Lock()
	if !p.isDecided {
		p.reads = append(p.reads, read)
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

// withdraw removes a target that will not report, so the decision does not
// wait for it.
func (p *historyPlan) withdraw(key string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.removeLocked(key)
}

func (p *historyPlan) removeLocked(key string) {
	delete(p.waiting, key)
	if p.isSealed && len(p.waiting) == 0 {
		p.decideLocked()
	}
}

func (p *historyPlan) decide() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.decideLocked()
}

func (p *historyPlan) decideLocked() {
	if p.isDecided {
		return
	}
	p.isDecided = true
	if p.decideTime != nil {
		p.decideTime.Stop()
	}
	p.cutoff = newestCutoff(p.reads, p.maxEntries, p.maxBytes)
	p.reads = nil
	close(p.decided)
}

// newestCutoff is the time of the oldest line the client can hold among the
// reads, or zero when every line fits.
func newestCutoff(reads [][]Entry, maxEntries, maxBytes int) time.Time {
	window := containerlogs.NewNewestWindow(maxEntries, maxBytes, entryTimestamp, entryLineBytes)
	for _, read := range reads {
		for _, entry := range read {
			window.Add(entry)
		}
	}
	kept, leftOut := window.Take()
	if leftOut == 0 || len(kept) == 0 {
		return time.Time{}
	}
	return parseLogTimestamp(kept[0].Timestamp)
}

// readsFurther reports whether a first read may have left out lines newer than
// the cut-off: its share came back full and its oldest line is after the
// cut-off, or nothing was cut off.
func readsFurther(read []Entry, share int, cutoff time.Time) bool {
	if len(read) < share {
		return false
	}
	oldest := parseLogTimestamp(read[0].Timestamp)
	return !oldest.IsZero() && (cutoff.IsZero() || oldest.After(cutoff))
}

// readHistory reads a container's last tail lines, only those from since's
// second on when since is set, without following. The whole read is bounded by
// the response timeout, since a plain read that stalls would never end.
func (s *Streamer) readHistory(ctx context.Context, target containerTarget, tail int, since time.Time) ([]Entry, error) {
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
		return nil, err
	}
	defer func() { _ = stream.Close() }()
	var entries []Entry
	reader := containerlogs.NewLineReader(stream)
	for {
		line, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return entries, nil
		}
		if err != nil {
			return nil, err
		}
		entries = append(entries, target.entry(line))
	}
}
