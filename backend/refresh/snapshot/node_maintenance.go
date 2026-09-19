package snapshot

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// RegisterNodeMaintenanceDomain wires the object-maintenance domain into the registry.
func RegisterNodeMaintenanceDomain(reg *domain.Registry, store *nodemaintenance.Store) error {
	if store == nil {
		return fmt.Errorf("node maintenance store is required")
	}
	return reg.Register(refresh.DomainConfig{
		Name: "object-maintenance",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			meta := ClusterMetaFromContext(ctx)
			if err := meta.Validate(); err != nil {
				return nil, err
			}
			clusterID, trimmed := refresh.SplitClusterScope(scope)
			if clusterID != "" && clusterID != meta.ClusterID {
				return nil, fmt.Errorf("node maintenance scope does not match cluster %s", meta.ClusterID)
			}
			nodeName := nodemaintenance.ParseScope(trimmed)
			payload, version := store.Snapshot(meta.ClusterID, nodeName)

			// Set cluster metadata on the payload itself.
			payload.ClusterID = meta.ClusterID
			payload.ClusterName = meta.ClusterName

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
