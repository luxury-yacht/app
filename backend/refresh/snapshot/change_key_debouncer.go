package snapshot

import (
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/doorbell"
)

// eventDoorbellDebounce coalesces event bursts (a crash-looping pod, a
// rollout) into one doorbell per window for every Events doorbell.
const eventDoorbellDebounce = 500 * time.Millisecond

// changeKeyDebouncer coalesces change keys recorded from informer goroutines
// into one ring per debounce window. Its timer is a generation callback, so
// stopping the cluster generation cancels a pending flush and waits for a
// running one.
type changeKeyDebouncer struct {
	bell     doorbell.Bell
	ring     func(version string, keys map[string]struct{})
	mu       sync.Mutex
	timer    doorbell.Timer
	debounce time.Duration
	dirty    map[string]struct{}
	prefix   string
	counter  uint64
}

func newChangeKeyDebouncer(
	bell doorbell.Bell,
	prefix string,
	debounce time.Duration,
	ring func(version string, keys map[string]struct{}),
) changeKeyDebouncer {
	return changeKeyDebouncer{
		bell:     bell,
		ring:     ring,
		debounce: debounce,
		dirty:    map[string]struct{}{},
		prefix:   prefix,
	}
}

func (d *changeKeyDebouncer) record(key string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.dirty[key] = struct{}{}
	if d.timer == nil {
		d.timer = d.bell.AfterFunc(d.debounce, d.flush)
	}
}

func (d *changeKeyDebouncer) flush() {
	d.mu.Lock()
	d.timer = nil
	keys := d.dirty
	d.dirty = map[string]struct{}{}
	if len(keys) == 0 {
		d.mu.Unlock()
		return
	}
	d.counter++
	version := fmt.Sprintf("%s-%d", d.prefix, d.counter)
	d.mu.Unlock()

	// keys is read-only from here on; the ring may read it while delivering.
	d.ring(version, keys)
}
