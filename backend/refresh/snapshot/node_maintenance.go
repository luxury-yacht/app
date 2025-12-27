package snapshot

import (
	"context"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// RegisterNodeMaintenanceDomain wires the node-maintenance domain into the registry.
func RegisterNodeMaintenanceDomain(reg *domain.Registry) error {
	store := nodemaintenance.GlobalStore()
	return reg.Register(refresh.DomainConfig{
		Name: "node-maintenance",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			meta := CurrentClusterMeta()
			clusterID, trimmed := refresh.SplitClusterScope(scope)
			nodeName := nodemaintenance.ParseScope(trimmed)
			payload, version := store.Snapshot(nodeName)
			payload.ClusterID = meta.ClusterID
			payload.ClusterName = meta.ClusterName
			for i := range payload.Drains {
				payload.Drains[i].ClusterID = meta.ClusterID
				payload.Drains[i].ClusterName = meta.ClusterName
			}
			return &refresh.Snapshot{
				Domain:  "node-maintenance",
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
