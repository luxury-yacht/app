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
	clusterIDs, scopeValue := refresh.SplitClusterScopeList(scope)
	targets, err := s.resolveTargets(domain, clusterIDs)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf("no clusters available for %s", domain)
	}

	allowPartial := len(clusterIDs) > 1 || (len(clusterIDs) == 0 && len(targets) > 1)
	snapshots := make([]*refresh.Snapshot, 0, len(targets))
	warnings := make([]string, 0, len(targets))
	var firstErr error
	for _, id := range targets {
		service := s.services[id]
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
func (s *aggregateSnapshotService) resolveTargets(domain string, clusterIDs []string) ([]string, error) {
	if len(clusterIDs) > 0 {
		targets := make([]string, 0, len(clusterIDs))
		for _, id := range clusterIDs {
			if _, ok := s.services[id]; !ok {
				return nil, fmt.Errorf("cluster %s not active", id)
			}
			if isSingleClusterDomain(domain) && id != s.primaryID {
				return nil, fmt.Errorf("domain %s is only available on the primary cluster", domain)
			}
			targets = append(targets, id)
		}
		return targets, nil
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

// formatClusterWarning prefixes a cluster identifier onto a warning message.
func formatClusterWarning(clusterID string, err error) string {
	if err == nil {
		return fmt.Sprintf("Cluster %s: unknown error", clusterID)
	}
	return fmt.Sprintf("Cluster %s: %s", clusterID, err.Error())
}
