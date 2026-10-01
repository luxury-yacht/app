package snapshot

import (
	"fmt"
	"sync"
	"time"
)

// eventDoorbellDebounce coalesces event bursts (a crash-looping pod, a
// rollout) into one doorbell per window for every Events doorbell.
const eventDoorbellDebounce = 500 * time.Millisecond

// changeKeyDebouncer coalesces change keys recorded from informer goroutines
// into one flush per debounce window. The doorbell notifiers built on it are
// created during domain registration, before the resource-stream manager
// exists, so keys recorded before the sink is wired are kept and flushed once
// it arrives.
type changeKeyDebouncer struct {
	mu       sync.Mutex
	sink     func(version string, keys map[string]struct{})
	timer    *time.Timer
	debounce time.Duration
	dirty    map[string]struct{}
	prefix   string
	counter  uint64
	stopped  bool
}

func newChangeKeyDebouncer(prefix string, debounce time.Duration) changeKeyDebouncer {
	return changeKeyDebouncer{
		debounce: debounce,
		dirty:    map[string]struct{}{},
		prefix:   prefix,
	}
}

// setSink wires the flush target. Keys recorded before wiring are flushed on
// the next debounce tick.
func (d *changeKeyDebouncer) setSink(sink func(version string, keys map[string]struct{})) {
	d.mu.Lock()
	d.sink = sink
	pending := len(d.dirty) > 0
	d.mu.Unlock()
	if pending {
		d.arm()
	}
}

func (d *changeKeyDebouncer) record(key string) {
	d.mu.Lock()
	if d.stopped {
		d.mu.Unlock()
		return
	}
	d.dirty[key] = struct{}{}
	d.mu.Unlock()
	d.arm()
}

// stop cancels any pending flush; the notifier is discarded with its subsystem.
func (d *changeKeyDebouncer) stop() {
	d.mu.Lock()
	d.stopped = true
	timer := d.timer
	d.timer = nil
	d.mu.Unlock()
	if timer != nil {
		timer.Stop()
	}
}

func (d *changeKeyDebouncer) arm() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stopped || d.timer != nil {
		return
	}
	d.timer = time.AfterFunc(d.debounce, d.flush)
}

func (d *changeKeyDebouncer) flush() {
	d.mu.Lock()
	d.timer = nil
	if d.stopped {
		d.mu.Unlock()
		return
	}
	sink := d.sink
	if sink == nil {
		// Not wired yet: keep the dirty keys; setSink re-arms.
		d.mu.Unlock()
		return
	}
	keys := d.dirty
	d.dirty = map[string]struct{}{}
	if len(keys) == 0 {
		d.mu.Unlock()
		return
	}
	d.counter++
	version := fmt.Sprintf("%s-%d", d.prefix, d.counter)
	d.mu.Unlock()

	// keys is read-only from here on; the sink may read it on the broadcast
	// goroutine.
	sink(version, keys)
}
