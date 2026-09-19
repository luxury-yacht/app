package backend

import (
	"strings"
	"sync"

	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateMetricsController routes frontend lease demand to the owning
// per-cluster metrics pollers. It retains demand across subsystem replacement so
// governor re-warm and auth recovery do not silently drop an active lease.
type aggregateMetricsController struct {
	mu         sync.Mutex
	subsystems map[string]*system.Subsystem
	demanded   map[string]struct{}
}

func newAggregateMetricsController(subsystems map[string]*system.Subsystem) *aggregateMetricsController {
	return &aggregateMetricsController{
		demanded:   make(map[string]struct{}),
		subsystems: copyRefreshSubsystems(subsystems),
	}
}

func (c *aggregateMetricsController) SetMetricsActiveForClusters(clusterIDs []string) {
	if c == nil {
		return
	}
	demanded := make(map[string]struct{}, len(clusterIDs))
	for _, clusterID := range clusterIDs {
		if clusterID = strings.TrimSpace(clusterID); clusterID != "" {
			demanded[clusterID] = struct{}{}
		}
	}
	c.mu.Lock()
	c.demanded = demanded
	applyMetricsDemand(c.subsystems, c.demanded)
	c.mu.Unlock()
}

func (c *aggregateMetricsController) Update(subsystems map[string]*system.Subsystem) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.subsystems = copyRefreshSubsystems(subsystems)
	applyMetricsDemand(c.subsystems, c.demanded)
	c.mu.Unlock()
}

func applyMetricsDemand(subsystems map[string]*system.Subsystem, demanded map[string]struct{}) {
	for clusterID, subsystem := range subsystems {
		if subsystem == nil || subsystem.Manager == nil {
			continue
		}
		_, active := demanded[clusterID]
		subsystem.Manager.SetMetricsActive(active)
	}
}
