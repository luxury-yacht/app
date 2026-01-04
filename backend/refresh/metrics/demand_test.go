package metrics

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type fakeDemandPoller struct {
	startCalls int32
	stopCalls  int32
	startCh    chan struct{}
	stopCh     chan struct{}
}

func newFakeDemandPoller() *fakeDemandPoller {
	return &fakeDemandPoller{
		startCh: make(chan struct{}, 1),
		stopCh:  make(chan struct{}, 1),
	}
}

func (f *fakeDemandPoller) Start(ctx context.Context) error {
	atomic.AddInt32(&f.startCalls, 1)
	f.startCh <- struct{}{}
	<-ctx.Done()
	return ctx.Err()
}

func (f *fakeDemandPoller) Stop(context.Context) error {
	atomic.AddInt32(&f.stopCalls, 1)
	f.stopCh <- struct{}{}
	return nil
}

func (f *fakeDemandPoller) LatestNodeUsage() map[string]NodeUsage {
	return map[string]NodeUsage{}
}

func (f *fakeDemandPoller) LatestPodUsage() map[string]PodUsage {
	return map[string]PodUsage{}
}

func (f *fakeDemandPoller) Metadata() Metadata {
	return Metadata{}
}

func TestDemandPollerStartsOnDemand(t *testing.T) {
	fake := newFakeDemandPoller()
	poller := NewDemandPoller(fake, fake, 200*time.Millisecond)

	if err := poller.Start(context.Background()); err != nil {
		t.Fatalf("unexpected start error: %v", err)
	}

	poller.LatestNodeUsage()

	select {
	case <-fake.startCh:
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("expected poller to start on demand")
	}

	if err := poller.Stop(context.Background()); err != nil {
		t.Fatalf("unexpected stop error: %v", err)
	}
}

func TestDemandPollerStopsAfterIdle(t *testing.T) {
	fake := newFakeDemandPoller()
	poller := NewDemandPoller(fake, fake, 10*time.Millisecond)

	if err := poller.Start(context.Background()); err != nil {
		t.Fatalf("unexpected start error: %v", err)
	}

	poller.SetActive(true)

	select {
	case <-fake.startCh:
	case <-time.After(100 * time.Millisecond):
		t.Fatalf("expected poller to start when active")
	}

	poller.SetActive(false)

	select {
	case <-fake.stopCh:
	case <-time.After(200 * time.Millisecond):
		t.Fatalf("expected poller to stop after idle timeout")
	}

	if err := poller.Stop(context.Background()); err != nil {
		t.Fatalf("unexpected stop error: %v", err)
	}
}
