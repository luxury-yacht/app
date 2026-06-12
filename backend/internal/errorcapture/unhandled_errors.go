/*
 * backend/internal/errorcapture/unhandled_errors.go
 *
 * Deduplicates the Kubernetes client libraries' unhandled-error log output.
 * Reflectors retry a broken watch every few seconds forever (for example a
 * resource type the cluster does not serve), and each retry logs the same
 * "Failed to watch" error. The deduper lets the first occurrence of an error
 * through and suppresses identical repeats for the rest of the session; a
 * different error always logs immediately.
 */

package errorcapture

import (
	"context"
	"sync"
	"time"

	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/klog/v2"
)

// unhandledErrorSeenLimit bounds the dedup map: once it grows past this size,
// the oldest entries are evicted. An evicted error would log again if it ever
// recurs, which is acceptable; unbounded growth from churning error text is not.
const unhandledErrorSeenLimit = 256

type unhandledErrorDeduper struct {
	mu   sync.Mutex
	seen map[string]time.Time
}

func newUnhandledErrorDeduper() *unhandledErrorDeduper {
	return &unhandledErrorDeduper{seen: make(map[string]time.Time)}
}

// unhandledErrorKey builds the dedup key from the same parameters a logging
// backend would render, so two occurrences collide only when they would have
// produced the same log line.
func unhandledErrorKey(err error, msg string, keysAndValues ...interface{}) string {
	return utilruntime.ErrorToString(err, msg, keysAndValues...)
}

func (d *unhandledErrorDeduper) shouldLog(key string, now time.Time) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.seen[key]; ok {
		return false
	}
	d.seen[key] = now
	for len(d.seen) > unhandledErrorSeenLimit {
		oldestKey := ""
		var oldest time.Time
		for k, at := range d.seen {
			if oldestKey == "" || at.Before(oldest) {
				oldestKey, oldest = k, at
			}
		}
		delete(d.seen, oldestKey)
	}
	return true
}

// InstallUnhandledErrorDedup replaces the Kubernetes libraries' global
// unhandled-error handlers with a deduplicating logger: each distinct error
// logs once per session. The replacement renders exactly like the default
// handler (logger name "UnhandledError", caller location of the reporting
// site), so suppression is the only observable difference. Call once at
// startup, before clients are built.
func InstallUnhandledErrorDedup() {
	deduper := newUnhandledErrorDeduper()
	utilruntime.ErrorHandlers = []utilruntime.ErrorHandler{
		func(ctx context.Context, err error, msg string, keysAndValues ...interface{}) {
			if !deduper.shouldLog(unhandledErrorKey(err, msg, keysAndValues...), time.Now()) {
				return
			}
			// Mirrors apimachinery's default logError handler: this function
			// runs at the same call depth, so the reported location stays the
			// caller of HandleError*.
			logger := klog.FromContext(ctx).WithCallDepth(3)
			logger = klog.LoggerWithName(logger, "UnhandledError")
			logger.Error(err, msg, keysAndValues...)
		},
	}
}
