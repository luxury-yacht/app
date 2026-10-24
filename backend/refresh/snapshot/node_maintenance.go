package snapshot

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const nodeMaintenanceDomain = "object-maintenance"

// RegisterNodeMaintenanceDomain wires the object-maintenance domain into the registry.
func RegisterNodeMaintenanceDomain(reg *domain.Registry, store *nodemaintenance.Store) error {
	if store == nil {
		return fmt.Errorf("node maintenance store is required")
	}
	return reg.Register(refresh.DomainConfig{
		Name: nodeMaintenanceDomain,
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			meta := ClusterMetaFromContext(ctx)
			if err := meta.Validate(); err != nil {
				return nil, err
			}
			clusterID, trimmed := refresh.SplitClusterScope(scope)
			if clusterID != "" && clusterID != meta.ClusterID {
				return nil, fmt.Errorf("node maintenance scope does not match cluster %s", meta.ClusterID)
			}
			// The cluster selector is the cluster-wide drain list; a node
			// selector narrows it to that node.
			selector, _, err := domain.ParseDomainScopeTail(nodeMaintenanceDomain, trimmed)
			if err != nil {
				return nil, err
			}
			payload, version := store.Snapshot(meta.ClusterID, selector.Node)

			// Set cluster metadata on the payload itself.
			payload.ClusterID = meta.ClusterID
			payload.ClusterName = meta.ClusterName

			return &refresh.Snapshot{
				Domain:  nodeMaintenanceDomain,
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
