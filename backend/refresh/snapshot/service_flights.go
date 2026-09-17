package snapshot

import (
	"context"
	"fmt"
	"runtime/debug"
	"sync"

	"github.com/luxury-yacht/app/backend/refresh"
)

// snapshotBuildFlights shares one build per key while giving every caller an
// independent wait context. The build is canceled only after every waiter
// leaves or the owning subsystem generation cancels all current flights.
type snapshotBuildFlights struct {
	mu      sync.Mutex
	flights map[string]*snapshotBuildFlight
}

type snapshotBuildFlight struct {
	done      chan struct{}
	cancel    context.CancelFunc
	waiters   int
	completed bool
	snapshot  *refresh.Snapshot
	err       error
}

func (f *snapshotBuildFlights) join(
	key string,
	requestCtx context.Context,
	build func(context.Context) (*refresh.Snapshot, error),
) *snapshotBuildFlight {
	f.mu.Lock()
	if flight := f.flights[key]; flight != nil {
		flight.waiters++
		f.mu.Unlock()
		return flight
	}
	if f.flights == nil {
		f.flights = make(map[string]*snapshotBuildFlight)
	}
	buildCtx, cancel := context.WithCancel(context.WithoutCancel(requestCtx))
	flight := &snapshotBuildFlight{
		done:    make(chan struct{}),
		cancel:  cancel,
		waiters: 1,
	}
	f.flights[key] = flight
	f.mu.Unlock()

	go func() {
		var snapshot *refresh.Snapshot
		var err error
		func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					err = fmt.Errorf("snapshot build panic: %v\n%s", recovered, debug.Stack())
				}
			}()
			snapshot, err = build(buildCtx)
		}()
		f.complete(key, flight, snapshot, err)
	}()
	return flight
}

func (f *snapshotBuildFlights) leave(key string, flight *snapshotBuildFlight) {
	if flight == nil {
		return
	}
	var cancel context.CancelFunc
	f.mu.Lock()
	if flight.waiters > 0 {
		flight.waiters--
	}
	if flight.waiters == 0 {
		cancel = f.finishLocked(key, flight, nil, context.Canceled)
	}
	f.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (f *snapshotBuildFlights) complete(
	key string,
	flight *snapshotBuildFlight,
	snapshot *refresh.Snapshot,
	err error,
) {
	f.mu.Lock()
	cancel := f.finishLocked(key, flight, snapshot, err)
	f.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (f *snapshotBuildFlights) cancelAll() {
	var cancels []context.CancelFunc
	f.mu.Lock()
	for key, flight := range f.flights {
		delete(f.flights, key)
		if cancel := f.finishLocked(key, flight, nil, context.Canceled); cancel != nil {
			cancels = append(cancels, cancel)
		}
	}
	f.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

// finishLocked publishes one terminal result. The caller cancels the build after
// releasing mu, so cancellation callbacks cannot re-enter the flight lock.
func (f *snapshotBuildFlights) finishLocked(
	key string,
	flight *snapshotBuildFlight,
	snapshot *refresh.Snapshot,
	err error,
) context.CancelFunc {
	if flight.completed {
		return nil
	}
	flight.completed = true
	flight.snapshot = snapshot
	flight.err = err
	if f.flights[key] == flight {
		delete(f.flights, key)
	}
	close(flight.done)
	return flight.cancel
}
