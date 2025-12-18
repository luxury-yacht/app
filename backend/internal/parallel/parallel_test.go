package parallel

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunLimitedRespectsLimit(t *testing.T) {
	var (
		current int64
		maxSeen int64
	)

	task := func(ctx context.Context) error {
		active := atomic.AddInt64(&current, 1)
		defer atomic.AddInt64(&current, -1)

		for {
			max := atomic.LoadInt64(&maxSeen)
			if active <= max || atomic.CompareAndSwapInt64(&maxSeen, max, active) {
				break
			}
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
			return nil
		}
	}

	tasks := []func(context.Context) error{
		task, task, task, task, task,
	}

	if err := RunLimited(context.Background(), 2, tasks...); err != nil {
		t.Fatalf("RunLimited returned error: %v", err)
	}

	if maxSeen > 2 {
		t.Fatalf("expected max concurrency <= 2, observed %d", maxSeen)
	}
}

func TestForEachRunsAllItems(t *testing.T) {
	items := []string{"a", "b", "c", "d"}

	var (
		mu       sync.Mutex
		visited  = make(map[string]int)
		current  int64
		maxSeen  int64
	)

	err := ForEach(context.Background(), items, 2, func(ctx context.Context, item string) error {
		active := atomic.AddInt64(&current, 1)
		defer atomic.AddInt64(&current, -1)

		for {
			max := atomic.LoadInt64(&maxSeen)
			if active <= max || atomic.CompareAndSwapInt64(&maxSeen, max, active) {
				break
			}
		}

		mu.Lock()
		visited[item]++
		mu.Unlock()

		time.Sleep(5 * time.Millisecond)
		return nil
	})
	if err != nil {
		t.Fatalf("ForEach returned error: %v", err)
	}

	if len(visited) != len(items) {
		t.Fatalf("expected %d visited items, got %d", len(items), len(visited))
	}
	for _, count := range visited {
		if count != 1 {
			t.Fatalf("expected each item once, saw %d", count)
		}
	}
	if maxSeen > 2 {
		t.Fatalf("expected max concurrency <= 2, observed %d", maxSeen)
	}
}

func TestCopyToPointers(t *testing.T) {
	values := []int{1, 2, 3}
	ptrs := CopyToPointers(values)

	if len(ptrs) != len(values) {
		t.Fatalf("expected %d pointers, got %d", len(values), len(ptrs))
	}

	for i, ptr := range ptrs {
		if ptr == nil {
			t.Fatalf("pointer %d is nil", i)
		}
		if *ptr != values[i] {
			t.Fatalf("pointer %d has value %d, expected %d", i, *ptr, values[i])
		}

		*ptr = *ptr + 10
		if values[i] != *ptr {
			t.Fatalf("pointer %d does not reference original element", i)
		}
	}
}
