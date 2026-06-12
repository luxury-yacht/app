/*
 * backend/internal/errorcapture/unhandled_errors.go
 *
 * Deduplicates the Kubernetes client libraries' unhandled-error log output.
 * Reflectors retry a broken watch every few seconds forever (for example a
 * resource type the cluster does not serve), and each retry logs the same
 * "Failed to watch" error. The deduper lets the first occurrence through,
 * suppresses identical repeats until a cooldown elapses, and logs any change
 * of error immediately.
 */

package errorcapture

import (
	"context"
	"sync"
	"time"

	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/klog/v2"
)

// unhandledErrorPruneThreshold bounds the dedup map: once it grows past this
// size, entries older than the cooldown are swept on the next insert.
const unhandledErrorPruneThreshold = 256

type unhandledErrorDeduper struct {
	cooldown   time.Duration
	mu         sync.Mutex
	lastLogged map[string]time.Time
}

func newUnhandledErrorDeduper(cooldown time.Duration) *unhandledErrorDeduper {
	return &unhandledErrorDeduper{
		cooldown:   cooldown,
		lastLogged: make(map[string]time.Time),
	}
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
	if last, ok := d.lastLogged[key]; ok && now.Sub(last) < d.cooldown {
		return false
	}
	if len(d.lastLogged) > unhandledErrorPruneThreshold {
		for k, last := range d.lastLogged {
			if now.Sub(last) >= d.cooldown {
				delete(d.lastLogged, k)
			}
		}
	}
	d.lastLogged[key] = now
	return true
}

// InstallUnhandledErrorDedup replaces the Kubernetes libraries' global
// unhandled-error handlers with a deduplicating logger. The replacement
// renders exactly like the default handler (logger name "UnhandledError",
// caller location of the reporting site), so suppression is the only
// observable difference. Call once at startup, before clients are built.
func InstallUnhandledErrorDedup(cooldown time.Duration) {
	deduper := newUnhandledErrorDeduper(cooldown)
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
