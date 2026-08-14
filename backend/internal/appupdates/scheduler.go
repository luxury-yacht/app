package appupdates

import (
	"context"
	"sync"
	"time"
)

// Scheduler owns immediate and periodic automatic check timing.
type Scheduler interface {
	Start(interval time.Duration, run func(context.Context))
	Stop()
}

type intervalScheduler struct {
	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

func newIntervalScheduler() *intervalScheduler {
	return &intervalScheduler{}
}

func (scheduler *intervalScheduler) Start(interval time.Duration, run func(context.Context)) {
	scheduler.mu.Lock()
	if scheduler.cancel != nil {
		scheduler.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	scheduler.cancel = cancel
	scheduler.done = done
	scheduler.mu.Unlock()

	go func() {
		defer close(done)
		run(ctx)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				run(ctx)
			}
		}
	}()
}

func (scheduler *intervalScheduler) Stop() {
	scheduler.mu.Lock()
	cancel := scheduler.cancel
	done := scheduler.done
	scheduler.cancel = nil
	scheduler.done = nil
	scheduler.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}
