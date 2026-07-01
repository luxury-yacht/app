//go:build !windows

package backend

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// TestGoroutineDumpEnabled pins the ENABLE_GOROUTINE_DUMP opt-in: the handler must arm
// only on an explicit truthy value (`ENABLE_GOROUTINE_DUMP=true wails dev`), never by
// default and never on garbage input.
func TestGoroutineDumpEnabled(t *testing.T) {
	cases := []struct {
		value string
		want  bool
	}{
		{"", false},
		{"false", false},
		{"0", false},
		{"garbage", false},
		{"true", true},
		{"TRUE", true},
		{"1", true},
	}
	for _, tc := range cases {
		if got := goroutineDumpEnabled(tc.value); got != tc.want {
			t.Errorf("goroutineDumpEnabled(%q) = %t, want %t", tc.value, got, tc.want)
		}
	}
}

// TestGoroutineDumpOnSignalWritesStacks proves the SIGUSR1 diagnostic handler writes every
// goroutine's stack to a file in the dump directory without stopping the process — the
// instrument for naming lock holders when the app wedges (views stuck loading, suspected
// deadlocks) and stderr is not capturable (wails dev child, Finder-launched .app).
func TestGoroutineDumpOnSignalWritesStacks(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Collect log messages; the handler logs from its own goroutine, so guard the slice.
	var mu sync.Mutex
	var logged []string
	logf := func(msg string) {
		mu.Lock()
		logged = append(logged, msg)
		mu.Unlock()
		t.Logf("%s", msg)
	}

	startGoroutineDumpOnSignal(ctx, dir, logf)

	// Arming must announce the PID synchronously: the operator targets the signal with
	// `kill -USR1 <pid>` read from the app log, so guessing process names is never needed.
	mu.Lock()
	armed := len(logged) > 0 && strings.Contains(logged[0], fmt.Sprintf("pid %d", os.Getpid()))
	mu.Unlock()
	if !armed {
		t.Fatalf("arming must log the process pid for signal targeting, got %q", logged)
	}

	if err := syscall.Kill(os.Getpid(), syscall.SIGUSR1); err != nil {
		t.Fatalf("sending SIGUSR1: %v", err)
	}

	var dump string
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		entries, err := os.ReadDir(dir)
		if err == nil && len(entries) > 0 {
			data, readErr := os.ReadFile(filepath.Join(dir, entries[0].Name()))
			if readErr == nil && len(data) > 0 {
				dump = string(data)
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	if dump == "" {
		t.Fatal("no goroutine dump file appeared after SIGUSR1")
	}
	// runtime.Stack output starts each goroutine section with "goroutine N [state]:".
	if !strings.Contains(dump, "goroutine ") {
		t.Fatalf("dump does not look like goroutine stacks:\n%.500s", dump)
	}
	// The dump must include OTHER goroutines than the handler's own (all=true), or it is
	// useless for naming a deadlock's second party. This test function's frame qualifies.
	if !strings.Contains(dump, "TestGoroutineDumpOnSignalWritesStacks") {
		t.Fatal("dump does not include other goroutines' stacks (runtime.Stack all=false?)")
	}
}
