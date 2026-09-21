package appwindow

import (
	"fmt"
	"iter"
	"time"
)

type transferPhase uint8

const (
	transferAwaitingSource transferPhase = iota
	transferAwaitingTarget
)

type pendingTransfer[T any] struct {
	value *T
	phase transferPhase
	timer *time.Timer
}

// transferLifecycle owns the common handoff state machine. The adapter holds
// its transaction lock across lifecycle and placement changes. Timeout callbacks
// reacquire that same lock through the adapter's failure entry point.
// Each protocol keeps its ID namespace: a tab opening a new native window
// deliberately uses the same ID for both acknowledgements.
type transferLifecycle[T any] struct {
	pending map[string]*pendingTransfer[T]
	used    map[string]struct{}
}

func (l *transferLifecycle[T]) begin(id string, value *T, phase transferPhase) error {
	if l.wasUsed(id) {
		return fmt.Errorf("transfer %q already exists", id)
	}
	if l.pending == nil {
		l.pending = make(map[string]*pendingTransfer[T])
		l.used = make(map[string]struct{})
	}
	l.used[id] = struct{}{}
	l.pending[id] = &pendingTransfer[T]{value: value, phase: phase}
	return nil
}

func (l *transferLifecycle[T]) wasUsed(id string) bool {
	_, used := l.used[id]
	return used
}

func (l *transferLifecycle[T]) get(id string) *T {
	if pending := l.pending[id]; pending != nil {
		return pending.value
	}
	return nil
}

func (l *transferLifecycle[T]) awaiting(id string, phase transferPhase) bool {
	pending := l.pending[id]
	return pending != nil && pending.phase == phase
}

func (l *transferLifecycle[T]) accept(id string) bool {
	if !l.awaiting(id, transferAwaitingSource) {
		return false
	}
	l.pending[id].phase = transferAwaitingTarget
	return true
}

func (l *transferLifecycle[T]) all() iter.Seq2[string, *T] {
	return func(yield func(string, *T) bool) {
		for id, pending := range l.pending {
			if !yield(id, pending.value) {
				return
			}
		}
	}
}

func (l *transferLifecycle[T]) setTimeout(id string, duration time.Duration, expire func()) {
	pending := l.pending[id]
	if pending == nil {
		return
	}
	if pending.timer != nil {
		pending.timer.Stop()
		pending.timer = nil
	}
	if duration > 0 {
		pending.timer = time.AfterFunc(duration, expire)
	}
}

func (l *transferLifecycle[T]) finish(id string) *T {
	pending := l.pending[id]
	if pending == nil {
		return nil
	}
	l.setTimeout(id, 0, nil)
	delete(l.pending, id)
	return pending.value
}
