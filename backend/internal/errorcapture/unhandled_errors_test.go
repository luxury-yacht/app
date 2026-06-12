package errorcapture

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestUnhandledErrorDeduperSuppressesRepeats(t *testing.T) {
	d := newUnhandledErrorDeduper(10 * time.Minute)
	base := time.Now()
	key := unhandledErrorKey(errors.New("failed to list *v1.TLSRoute: not found"), "Failed to watch", "type", "*v1.TLSRoute")

	if !d.shouldLog(key, base) {
		t.Fatalf("first occurrence should log")
	}
	if d.shouldLog(key, base.Add(5*time.Second)) {
		t.Fatalf("repeat within the cooldown should be suppressed")
	}
	if !d.shouldLog(key, base.Add(10*time.Minute+time.Second)) {
		t.Fatalf("repeat after the cooldown should log again as a reminder")
	}
	if d.shouldLog(key, base.Add(10*time.Minute+2*time.Second)) {
		t.Fatalf("cooldown should restart after the reminder")
	}
}

func TestUnhandledErrorDeduperDistinctErrorsLogImmediately(t *testing.T) {
	d := newUnhandledErrorDeduper(10 * time.Minute)
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

func TestUnhandledErrorDeduperPrunesExpiredEntries(t *testing.T) {
	d := newUnhandledErrorDeduper(time.Minute)
	base := time.Now()
	for i := 0; i < unhandledErrorPruneThreshold+10; i++ {
		d.shouldLog(unhandledErrorKey(fmt.Errorf("err-%d", i), "msg"), base)
	}
	// All previous entries are past the cooldown; the next insert must prune them.
	d.shouldLog(unhandledErrorKey(errors.New("fresh"), "msg"), base.Add(2*time.Minute))
	d.mu.Lock()
	size := len(d.lastLogged)
	d.mu.Unlock()
	if size > 1 {
		t.Fatalf("expected expired entries to be pruned, still have %d", size)
	}
}
