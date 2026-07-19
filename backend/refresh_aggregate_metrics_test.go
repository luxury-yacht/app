package backend

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

type recordingMetricsPoller struct {
	active []bool
}

type blockingMetricsPoller struct {
	started chan struct{}
	release chan struct{}
	mu      sync.Mutex
	active  []bool
}

func (*blockingMetricsPoller) Start(context.Context) error { return nil }
func (*blockingMetricsPoller) Stop(context.Context) error  { return nil }
func (p *blockingMetricsPoller) SetActive(active bool) {
	if active {
		close(p.started)
		<-p.release
	}
	p.mu.Lock()
	p.active = append(p.active, active)
	p.mu.Unlock()
}

func (p *blockingMetricsPoller) values() []bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]bool(nil), p.active...)
}

func (*recordingMetricsPoller) Start(context.Context) error { return nil }
func (*recordingMetricsPoller) Stop(context.Context) error  { return nil }
func (p *recordingMetricsPoller) SetActive(active bool) {
	p.active = append(p.active, active)
}

func metricsSubsystem(poller *recordingMetricsPoller) *system.Subsystem {
	return &system.Subsystem{Manager: refresh.NewManager(nil, nil, nil, poller, nil)}
}

func TestAggregateMetricsDemandRoutesByClusterID(t *testing.T) {
	pollerA := &recordingMetricsPoller{}
	pollerB := &recordingMetricsPoller{}
	controller := newAggregateMetricsController(map[string]*system.Subsystem{
		"cluster-a": metricsSubsystem(pollerA),
		"cluster-b": metricsSubsystem(pollerB),
	})

	controller.SetMetricsActiveForClusters([]string{"cluster-b"})

	require.Equal(t, []bool{false}, pollerA.active)
	require.Equal(t, []bool{true}, pollerB.active)
}

func TestAggregateMetricsDemandSurvivesSubsystemReplacement(t *testing.T) {
	oldPoller := &recordingMetricsPoller{}
	controller := newAggregateMetricsController(map[string]*system.Subsystem{
		"cluster-a": metricsSubsystem(oldPoller),
	})
	controller.SetMetricsActiveForClusters([]string{"cluster-a"})

	newPoller := &recordingMetricsPoller{}
	controller.Update(map[string]*system.Subsystem{
		"cluster-a": metricsSubsystem(newPoller),
	})

	require.Equal(t, []bool{true}, newPoller.active)
}

func TestAggregateMetricsDemandAppliesConcurrentUpdatesInArrivalOrder(t *testing.T) {
	poller := &blockingMetricsPoller{started: make(chan struct{}), release: make(chan struct{})}
	controller := newAggregateMetricsController(map[string]*system.Subsystem{
		"cluster-a": {Manager: refresh.NewManager(nil, nil, nil, poller, nil)},
	})

	firstDone := make(chan struct{})
	go func() {
		controller.SetMetricsActiveForClusters([]string{"cluster-a"})
		close(firstDone)
	}()
	<-poller.started

	secondDone := make(chan struct{})
	go func() {
		controller.SetMetricsActiveForClusters(nil)
		close(secondDone)
	}()

	select {
	case <-secondDone:
		// The old implementation reaches here because it releases the controller
		// lock before applying the first demand update.
	case <-time.After(100 * time.Millisecond):
		// A serialized implementation keeps the second update behind the first.
	}
	close(poller.release)
	<-firstDone
	<-secondDone

	require.Equal(t, []bool{true, false}, poller.values())
}
