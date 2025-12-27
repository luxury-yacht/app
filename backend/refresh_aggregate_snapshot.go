package backend

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateSnapshotService fans out snapshot builds to per-cluster services and merges results.
type aggregateSnapshotService struct {
	primaryID    string
	clusterOrder []string
	services     map[string]refresh.SnapshotService
}

// newAggregateSnapshotService builds an aggregator for the provided cluster snapshot services.
func newAggregateSnapshotService(
	primaryID string,
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

	if primaryID == "" && len(ordered) > 0 {
		primaryID = ordered[0]
	}

	return &aggregateSnapshotService{
		primaryID:    primaryID,
		clusterOrder: ordered,
		services:     services,
	}
}

// Build fans out the snapshot request and merges payloads for multi-cluster domains.
func (s *aggregateSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	clusterID, scopeValue := refresh.SplitClusterScope(scope)
	targets, err := s.resolveTargets(domain, clusterID)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf("no clusters available for %s", domain)
	}

	snapshots := make([]*refresh.Snapshot, 0, len(targets))
	for _, id := range targets {
		service := s.services[id]
		if service == nil {
			return nil, fmt.Errorf("snapshot service unavailable for %s", id)
		}
		scoped := refresh.JoinClusterScope(id, scopeValue)
		snapshotData, err := service.Build(ctx, domain, scoped)
		if err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshotData)
	}

	if len(snapshots) == 1 {
		return snapshots[0], nil
	}

	return snapshot.MergeSnapshots(domain, scope, snapshots)
}

// resolveTargets chooses which clusters should handle the requested domain/scope pair.
func (s *aggregateSnapshotService) resolveTargets(domain, scopeClusterID string) ([]string, error) {
	if scopeClusterID != "" {
		if _, ok := s.services[scopeClusterID]; !ok {
			return nil, fmt.Errorf("cluster %s not active", scopeClusterID)
		}
		if isSingleClusterDomain(domain) && scopeClusterID != s.primaryID {
			return nil, fmt.Errorf("domain %s is only available on the primary cluster", domain)
		}
		return []string{scopeClusterID}, nil
	}

	if isSingleClusterDomain(domain) {
		if s.primaryID == "" {
			return nil, fmt.Errorf("primary cluster not available")
		}
		return []string{s.primaryID}, nil
	}

	return append([]string(nil), s.clusterOrder...), nil
}

// isSingleClusterDomain restricts object-scoped and catalog domains to one cluster for now.
func isSingleClusterDomain(domain string) bool {
	switch domain {
	case "catalog", "node-maintenance":
		return true
	default:
		return strings.HasPrefix(domain, "object-")
	}
}
