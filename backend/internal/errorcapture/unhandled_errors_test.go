package errorcapture

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestUnhandledErrorDeduperLogsEachErrorOnce(t *testing.T) {
	d := newUnhandledErrorDeduper()
	base := time.Now()
	key := unhandledErrorKey(errors.New("failed to list *v1.TLSRoute: not found"), "Failed to watch", "type", "*v1.TLSRoute")

	if !d.shouldLog(key, base) {
		t.Fatalf("first occurrence should log")
	}
	if d.shouldLog(key, base.Add(5*time.Second)) {
		t.Fatalf("repeat should be suppressed")
	}
	if d.shouldLog(key, base.Add(10*time.Minute)) {
		t.Fatalf("repeat minutes later should still be suppressed")
	}
	if d.shouldLog(key, base.Add(24*time.Hour)) {
		t.Fatalf("repeat hours later should still be suppressed — once means once")
	}
}

func TestUnhandledErrorDeduperDistinctErrorsLogImmediately(t *testing.T) {
	d := newUnhandledErrorDeduper()
	base := time.Now()

	first := unhandledErrorKey(errors.New("failed to list *v1.TLSRoute: not found"), "Failed to watch")
	second := unhandledErrorKey(errors.New("failed to list *v1.ListenerSet: not found"), "Failed to watch")
	if first == second {
		t.Fatalf("distinct errors must produce distinct keys")
	}
	if !d.shouldLog(first, base) {
		t.Fatalf("first error should log")
	}
	if !d.shouldLog(second, base.Add(time.Second)) {
		t.Fatalf("a different error should log immediately")
	}
}

func TestUnhandledErrorKeyHandlesNilError(t *testing.T) {
	// HandleErrorWithContext is documented to allow nil errors.
	withNil := unhandledErrorKey(nil, "watch closed")
	withErr := unhandledErrorKey(errors.New("boom"), "watch closed")
	if withNil == withErr {
		t.Fatalf("nil and non-nil errors should produce distinct keys")
	}
}

func TestUnhandledErrorDeduperEvictsOldestWhenOverThreshold(t *testing.T) {
	d := newUnhandledErrorDeduper()
	base := time.Now()
	oldest := unhandledErrorKey(errors.New("the very first error"), "msg")
	d.shouldLog(oldest, base)
	for i := 0; i < unhandledErrorSeenLimit+10; i++ {
		d.shouldLog(unhandledErrorKey(fmt.Errorf("err-%d", i), "msg"), base.Add(time.Duration(i+1)*time.Second))
	}

	d.mu.Lock()
	size := len(d.seen)
	d.mu.Unlock()
	if size > unhandledErrorSeenLimit {
		t.Fatalf("expected seen map to stay bounded at %d, got %d", unhandledErrorSeenLimit, size)
	}
	// The oldest entry must be the one evicted, so it would log again while
	// recently seen errors stay suppressed.
	if !d.shouldLog(oldest, base.Add(time.Hour)) {
		t.Fatalf("expected the oldest entry to have been evicted")
	}
}
