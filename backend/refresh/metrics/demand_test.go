package metrics

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
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

func (f *fakeDemandPoller) Sample() Sample {
	return Sample{
		NodeUsage: f.LatestNodeUsage(),
		PodUsage:  f.LatestPodUsage(),
		Metadata:  f.Metadata(),
	}
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

func TestDemandPollerStopBlocksProviderRestartsUntilExplicitStart(t *testing.T) {
	fake := newFakeDemandPoller()
	poller := NewDemandPoller(fake, fake, time.Minute)

	require.NoError(t, poller.Start(context.Background()))
	poller.LatestNodeUsage()
	select {
	case <-fake.startCh:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected initial provider read to start polling")
	}
	require.NoError(t, poller.Stop(context.Background()))

	poller.LatestPodUsage()
	select {
	case <-fake.startCh:
		t.Fatal("provider read restarted polling after terminal stop")
	case <-time.After(50 * time.Millisecond):
	}
	require.Equal(t, int32(1), atomic.LoadInt32(&fake.startCalls))

	require.NoError(t, poller.Start(context.Background()))
	poller.LatestPodUsage()
	select {
	case <-fake.startCh:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("explicit Start did not re-arm demand polling")
	}
	require.Equal(t, int32(2), atomic.LoadInt32(&fake.startCalls))
}
