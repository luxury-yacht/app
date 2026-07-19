package backend

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

type recordingMetricsPoller struct {
	active []bool
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
