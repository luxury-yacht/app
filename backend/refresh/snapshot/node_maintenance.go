package snapshot

import (
	"context"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// RegisterNodeMaintenanceDomain wires the object-maintenance domain into the registry.
func RegisterNodeMaintenanceDomain(reg *domain.Registry) error {
	store := nodemaintenance.GlobalStore()
	return reg.Register(refresh.DomainConfig{
		Name: "object-maintenance",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			meta := ClusterMetaFromContext(ctx)
			clusterID, trimmed := refresh.SplitClusterScope(scope)
			nodeName := nodemaintenance.ParseScope(trimmed)

			// Get snapshot filtered by node name.
			payload, version := store.Snapshot(nodeName)

			// Set cluster metadata on the payload itself.
			payload.ClusterID = meta.ClusterID
			payload.ClusterName = meta.ClusterName

			// Filter drain jobs by cluster ID to ensure proper isolation.
			// This prevents drain jobs from other clusters from bleeding through
			// when nodes in different clusters share the same name.
			payload.Drains = filterDrainJobsByCluster(payload.Drains, meta.ClusterID)

			return &refresh.Snapshot{
				Domain:  "object-maintenance",
				Scope:   refresh.JoinClusterScope(clusterID, trimmed),
				Version: version,
				Payload: payload,
				Stats: refresh.SnapshotStats{
					ItemCount: len(payload.Drains),
				},
			}, nil
		},
	})
}

// filterDrainJobsByCluster returns only drain jobs that belong to the specified cluster.
// Jobs without a cluster ID (legacy jobs) are excluded to prevent cross-cluster pollution.
func filterDrainJobsByCluster(jobs []nodemaintenance.DrainJob, clusterID string) []nodemaintenance.DrainJob {
	if clusterID == "" {
		return jobs
	}

	var result []nodemaintenance.DrainJob
	for _, job := range jobs {
		if job.ClusterID == clusterID {
			result = append(result, job)
		}
	}
	return result
}
