package system

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/stretchr/testify/require"
)

type routesMetricsPoller struct {
	active []bool
}

func (*routesMetricsPoller) Start(context.Context) error { return nil }
func (*routesMetricsPoller) Stop(context.Context) error  { return nil }
func (p *routesMetricsPoller) SetActive(active bool) {
	p.active = append(p.active, active)
}

func TestSingleClusterMetricsDemandControllerMatchesItsCluster(t *testing.T) {
	poller := &routesMetricsPoller{}
	controller := singleClusterMetricsDemandController{
		clusterID: "cluster-a",
		manager:   refresh.NewManager(nil, nil, nil, poller, nil),
	}

	controller.SetMetricsActiveForClusters([]string{"cluster-b"})
	controller.SetMetricsActiveForClusters([]string{"cluster-b", "cluster-a"})

	require.Equal(t, []bool{false, true}, poller.active)
}
