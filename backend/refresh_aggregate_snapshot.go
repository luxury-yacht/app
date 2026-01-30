package backend

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateSnapshotService fans out snapshot builds to per-cluster services and merges results.
type aggregateSnapshotService struct {
	clusterOrder []string
	services     map[string]refresh.SnapshotService
	mu           sync.RWMutex
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

// Build fans out the snapshot request and merges payloads for multi-cluster domains.
func (s *aggregateSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	clusterOrder, services := s.snapshotConfig()
	clusterIDs, scopeValue := refresh.SplitClusterScopeList(scope)
	targets, err := s.resolveTargets(domain, clusterIDs, services, clusterOrder)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf("no clusters available for %s", domain)
	}

	allowPartial := len(clusterIDs) > 1
	snapshots := make([]*refresh.Snapshot, 0, len(targets))
	warnings := make([]string, 0, len(targets))
	var firstErr error
	for _, id := range targets {
		service := services[id]
		if service == nil {
			buildErr := fmt.Errorf("snapshot service unavailable for %s", id)
			if !allowPartial {
				return nil, buildErr
			}
			if firstErr == nil {
				firstErr = buildErr
			}
			warnings = append(warnings, formatClusterWarning(id, buildErr))
			continue
		}
		scoped := refresh.JoinClusterScope(id, scopeValue)
		snapshotData, err := service.Build(ctx, domain, scoped)
		if err != nil {
			if !allowPartial {
				return nil, err
			}
			if firstErr == nil {
				firstErr = err
			}
			// Preserve partial data when a cluster fails in multi-cluster views.
			warnings = append(warnings, formatClusterWarning(id, err))
			continue
		}
		snapshots = append(snapshots, snapshotData)
	}

	if len(snapshots) == 0 {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, fmt.Errorf("no snapshots built for %s", domain)
	}
	if len(snapshots) == 1 {
		merged := snapshots[0]
		if len(warnings) > 0 {
			merged.Stats.Warnings = append(merged.Stats.Warnings, warnings...)
		}
		return merged, nil
	}

	merged, err := snapshot.MergeSnapshots(domain, scope, snapshots)
	if err != nil {
		return nil, err
	}
	if len(warnings) > 0 {
		merged.Stats.Warnings = append(merged.Stats.Warnings, warnings...)
	}
	return merged, nil
}

// resolveTargets chooses which clusters should handle the requested domain/scope pair.
// Clusters without services (e.g., due to auth failure) are skipped gracefully.
func (s *aggregateSnapshotService) resolveTargets(
	domain string,
	clusterIDs []string,
	services map[string]refresh.SnapshotService,
	clusterOrder []string,
) ([]string, error) {
	if len(clusterIDs) > 0 {
		if isSingleClusterDomain(domain) && len(clusterIDs) > 1 {
			return nil, fmt.Errorf("domain %s is only available on a single cluster", domain)
		}
		targets := make([]string, 0, len(clusterIDs))
		for _, id := range clusterIDs {
			// Skip clusters without services (e.g., auth failure caused subsystem to be skipped).
			// This allows multi-cluster views to show data from working clusters.
			if _, ok := services[id]; !ok {
				continue
			}
			targets = append(targets, id)
		}
		// Only error if NO clusters are available
		if len(targets) == 0 {
			return nil, fmt.Errorf("no active clusters available (requested: %v)", clusterIDs)
		}
		return targets, nil
	}

	return nil, fmt.Errorf("cluster scope is required for domain %s", domain)
}

func (s *aggregateSnapshotService) snapshotConfig() ([]string, map[string]refresh.SnapshotService) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	order := append([]string(nil), s.clusterOrder...)
	services := make(map[string]refresh.SnapshotService, len(s.services))
	for id, service := range s.services {
		services[id] = service
	}
	return order, services
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

// isSingleClusterDomain restricts object-scoped and catalog domains to one cluster for now.
func isSingleClusterDomain(domain string) bool {
	switch domain {
	case "catalog", "catalog-diff", "node-maintenance":
		return true
	default:
		return strings.HasPrefix(domain, "object-")
	}
}

// formatClusterWarning prefixes a cluster identifier onto a warning message.
func formatClusterWarning(clusterID string, err error) string {
	if err == nil {
		return fmt.Sprintf("Cluster %s: unknown error", clusterID)
	}
	return fmt.Sprintf("Cluster %s: %s", clusterID, err.Error())
}
