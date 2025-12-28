package backend

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
)

// stubSnapshotService provides deterministic snapshot responses for aggregator tests.
type stubSnapshotService struct {
	build func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error)
}

func (s stubSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	return s.build(ctx, domain, scope)
}

func TestAggregateSnapshotServiceBuildAllowsPartialFailures(t *testing.T) {
	successSnapshot := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces: []snapshot.NamespaceSummary{
				{Name: "default"},
			},
		},
	}

	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return successSnapshot, nil
			},
		},
		"cluster-b": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return nil, refresh.NewPermissionDeniedError(domain, "")
			},
		},
	}
	aggregate := &aggregateSnapshotService{
		primaryID:    "cluster-a",
		clusterOrder: []string{"cluster-a", "cluster-b"},
		services:     services,
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "")
	require.NoError(t, err)
	require.NotNil(t, snap)

	payload, ok := snap.Payload.(snapshot.NamespaceSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Namespaces, 1)
	require.Equal(t, "default", payload.Namespaces[0].Name)
	require.Contains(t, snap.Stats.Warnings, "Cluster cluster-b: permission denied for domain namespaces")
}

func TestAggregateSnapshotServiceBuildAllowsPartialFailuresForClusterList(t *testing.T) {
	successSnapshot := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces: []snapshot.NamespaceSummary{
				{Name: "default"},
			},
		},
	}

	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return successSnapshot, nil
			},
		},
		"cluster-b": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return nil, refresh.NewPermissionDeniedError(domain, "")
			},
		},
	}
	aggregate := &aggregateSnapshotService{
		primaryID:    "cluster-a",
		clusterOrder: []string{"cluster-a", "cluster-b"},
		services:     services,
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a,cluster-b|")
	require.NoError(t, err)
	require.NotNil(t, snap)

	payload, ok := snap.Payload.(snapshot.NamespaceSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Namespaces, 1)
	require.Equal(t, "default", payload.Namespaces[0].Name)
	require.Contains(t, snap.Stats.Warnings, "Cluster cluster-b: permission denied for domain namespaces")
}

func TestAggregateSnapshotServiceBuildReturnsErrorWhenAllClustersFail(t *testing.T) {
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return nil, refresh.NewPermissionDeniedError(domain, "")
			},
		},
		"cluster-b": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return nil, refresh.NewPermissionDeniedError(domain, "")
			},
		},
	}
	aggregate := &aggregateSnapshotService{
		primaryID:    "cluster-a",
		clusterOrder: []string{"cluster-a", "cluster-b"},
		services:     services,
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "")
	require.Error(t, err)
	require.True(t, refresh.IsPermissionDenied(err))
	require.Nil(t, snap)
}
