package backend

import (
	"context"
	"fmt"
	"maps"
	"sort"
	"sync"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateSnapshotService routes cluster-scoped snapshot builds to per-cluster services.
type aggregateSnapshotService struct {
	clusterOrder []string
	services     map[string]refresh.SnapshotService
	mu           sync.RWMutex

	// onNamespaceSnapshot is called when a namespace snapshot builds successfully.
	// Used by the lifecycle module to transition loading -> ready.
	onNamespaceSnapshot func(clusterID string)
}

// newAggregateSnapshotService builds an aggregator for the provided cluster snapshot services.
func newAggregateSnapshotService(
	clusterOrder []string,
	subsystems map[string]*system.Subsystem,
) *aggregateSnapshotService {
	services := make(map[string]refresh.SnapshotService)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.SnapshotService == nil {
			continue
		}
		services[id] = subsystem.SnapshotService
	}

	ordered := make([]string, 0, len(clusterOrder))
	for _, id := range clusterOrder {
		if _, ok := services[id]; ok {
			ordered = append(ordered, id)
		}
	}

	if len(ordered) == 0 {
		for id := range services {
			ordered = append(ordered, id)
		}
		sort.Strings(ordered)
	}

	return &aggregateSnapshotService{
		clusterOrder: ordered,
		services:     services,
	}
}

// Build routes one cluster-scoped snapshot request to the owning per-cluster service.
func (s *aggregateSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	services := s.snapshotConfig()
	clusterIDs, scopeValue := refresh.SplitClusterScopeList(scope)
	target, err := s.resolveTarget(domain, clusterIDs, services)
	if err != nil {
		return nil, err
	}

	service := services[target]
	if service == nil {
		return nil, fmt.Errorf("snapshot service unavailable for %s", target)
	}
	scoped := refresh.JoinClusterScope(target, scopeValue)
	snapshotData, err := service.Build(ctx, domain, scoped)
	if err != nil {
		return nil, err
	}

	// Notify the lifecycle module on every successful namespace snapshot.
	// The lifecycle callback is state-gated, so this also recovers clusters
	// that re-enter loading after an in-place subsystem rebuild.
	if domain == "namespaces" {
		s.notifyNamespaceSnapshot(target)
	}
	return snapshotData, nil
}

// resolveTarget chooses which cluster should handle the requested domain/scope pair.
func (s *aggregateSnapshotService) resolveTarget(
	domain string,
	clusterIDs []string,
	services map[string]refresh.SnapshotService,
) (string, error) {
	if len(clusterIDs) == 0 {
		return "", fmt.Errorf("cluster scope is required for domain %s", domain)
	}
	if len(clusterIDs) > 1 {
		return "", fmt.Errorf("domain %s requires a single cluster scope (requested: %v)", domain, clusterIDs)
	}

	target := clusterIDs[0]
	if _, ok := services[target]; !ok {
		return "", fmt.Errorf("no active clusters available (requested: %v)", clusterIDs)
	}
	return target, nil
}

func (s *aggregateSnapshotService) snapshotConfig() map[string]refresh.SnapshotService {
	s.mu.RLock()
	defer s.mu.RUnlock()
	services := make(map[string]refresh.SnapshotService, len(s.services))
	maps.Copy(services, s.services)
	return services
}

// Update refreshes the aggregate snapshot configuration after selection changes.
func (s *aggregateSnapshotService) Update(clusterOrder []string, subsystems map[string]*system.Subsystem) {
	if s == nil {
		return
	}
	next := newAggregateSnapshotService(clusterOrder, subsystems)
	s.mu.Lock()
	s.clusterOrder = next.clusterOrder
	s.services = next.services
	s.mu.Unlock()
}

// notifyNamespaceSnapshot fires the lifecycle callback for a successful namespace snapshot.
func (s *aggregateSnapshotService) notifyNamespaceSnapshot(clusterID string) {
	if s.onNamespaceSnapshot == nil {
		return
	}
	s.onNamespaceSnapshot(clusterID)
}
