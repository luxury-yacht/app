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
	controller := &aggregateMetricsController{demanded: make(map[string]struct{})}
	controller.updateConfig(subsystems)
	return controller
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
	c.updateConfigLocked(subsystems)
	applyMetricsDemand(c.subsystems, c.demanded)
	c.mu.Unlock()
}

func (c *aggregateMetricsController) updateConfig(subsystems map[string]*system.Subsystem) {
	c.mu.Lock()
	c.updateConfigLocked(subsystems)
	c.mu.Unlock()
}

func (c *aggregateMetricsController) updateConfigLocked(subsystems map[string]*system.Subsystem) {
	c.subsystems = copyMetricsSubsystems(subsystems)
}

func copyMetricsSubsystems(source map[string]*system.Subsystem) map[string]*system.Subsystem {
	copy := make(map[string]*system.Subsystem, len(source))
	for clusterID, subsystem := range source {
		copy[clusterID] = subsystem
	}
	return copy
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
