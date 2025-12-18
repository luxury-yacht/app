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
			nodeName := nodemaintenance.ParseScope(scope)
			payload, version := store.Snapshot(nodeName)
			return &refresh.Snapshot{
				Domain:  "node-maintenance",
				Scope:   scope,
				Version: version,
				Payload: payload,
				Stats: refresh.SnapshotStats{
					ItemCount: len(payload.Drains),
				},
			}, nil
		},
	})
}
