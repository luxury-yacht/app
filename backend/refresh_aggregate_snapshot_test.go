package backend

import (
	"context"
	"testing"
	"time"

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

func TestAggregateSnapshotServiceBuildRequiresClusterScope(t *testing.T) {
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
		clusterOrder: []string{"cluster-a", "cluster-b"},
		services:     services,
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "")
	require.Error(t, err)
	require.Nil(t, snap)
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

func TestAggregateSnapshotServiceFirstNamespaceSnapshotTransitionsToReady(t *testing.T) {
	successSnapshot := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces: []snapshot.NamespaceSummary{{Name: "default"}},
		},
	}
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return successSnapshot, nil
			},
		},
	}

	var called []string
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services:     services,
		onFirstSnapshot: func(clusterID string) {
			called = append(called, clusterID)
		},
	}

	// First namespace build triggers the callback.
	snap, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.Equal(t, []string{"cluster-a"}, called)

	// Second call does NOT fire again (once-per-cluster semantics).
	snap, err = aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.Equal(t, []string{"cluster-a"}, called, "callback must fire only once per cluster")
}

func TestAggregateSnapshotServiceNonNamespaceDomainDoesNotTriggerCallback(t *testing.T) {
	successSnapshot := &refresh.Snapshot{
		Domain:  "cluster-overview",
		Payload: map[string]string{"test": "data"},
	}
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return successSnapshot, nil
			},
		},
	}

	callbackFired := false
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services:     services,
		onFirstSnapshot: func(clusterID string) {
			callbackFired = true
		},
	}

	snap, err := aggregate.Build(context.Background(), "cluster-overview", "clusters=cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.False(t, callbackFired, "callback must only fire for namespaces domain")
}

func TestAggregateSnapshotServiceFailedBuildDoesNotTriggerCallback(t *testing.T) {
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return nil, refresh.NewPermissionDeniedError(domain, "")
			},
		},
	}

	callbackFired := false
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services:     services,
		onFirstSnapshot: func(clusterID string) {
			callbackFired = true
		},
	}

	_, _ = aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.False(t, callbackFired, "callback must not fire on build failure")
}

func TestAggregateSnapshotServiceUpdateClearsRemovedClusterTracking(t *testing.T) {
	successSnapshot := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces: []snapshot.NamespaceSummary{{Name: "default"}},
		},
	}

	var callCount int
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services: map[string]refresh.SnapshotService{
			"cluster-a": stubSnapshotService{
				build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
					return successSnapshot, nil
				},
			},
		},
		onFirstSnapshot: func(clusterID string) {
			callCount++
		},
	}

	// Initial build fires the callback.
	_, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.Equal(t, 1, callCount)

	// Simulate cluster-a being removed, then re-added.
	aggregate.Update([]string{}, nil) // removes cluster-a from services
	aggregate.mu.Lock()
	aggregate.clusterOrder = []string{"cluster-a"}
	aggregate.services = map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return successSnapshot, nil
			},
		},
	}
	aggregate.mu.Unlock()

	// Build again should fire the callback since tracking was cleared.
	_, err = aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.Equal(t, 2, callCount, "callback must fire again after cluster tracking was cleared")
}

func TestAggregateSnapshotServiceLifecycleIntegration(t *testing.T) {
	// Integration test: verify the full lifecycle wiring from loading → ready
	// through the aggregate snapshot service with a real clusterLifecycle.
	emitter, getEvents := collectingEmitter()
	lifecycle := newClusterLifecycleWithSlowThreshold(emitter, time.Minute)
	lifecycle.SetState("cluster-a", ClusterStateLoading)

	successSnapshot := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces: []snapshot.NamespaceSummary{{Name: "default"}},
		},
	}
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services: map[string]refresh.SnapshotService{
			"cluster-a": stubSnapshotService{
				build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
					return successSnapshot, nil
				},
			},
		},
		onFirstSnapshot: func(clusterID string) {
			state := lifecycle.GetState(clusterID)
			if state == ClusterStateLoading || state == ClusterStateLoadingSlow {
				lifecycle.SetState(clusterID, ClusterStateReady)
			}
		},
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.Equal(t, ClusterStateReady, lifecycle.GetState("cluster-a"))

	events := getEvents()
	require.Len(t, events, 2)
	require.Equal(t, emittedEvent{"cluster-a", "loading", ""}, events[0])
	require.Equal(t, emittedEvent{"cluster-a", "ready", "loading"}, events[1])
}

func TestAggregateSnapshotServiceLifecycleNoTransitionIfAlreadyReady(t *testing.T) {
	// Verify that the callback doesn't re-transition a cluster that's already ready.
	emitter, getEvents := collectingEmitter()
	lifecycle := newClusterLifecycleWithSlowThreshold(emitter, time.Minute)
	lifecycle.SetState("cluster-a", ClusterStateReady)

	successSnapshot := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces: []snapshot.NamespaceSummary{{Name: "default"}},
		},
	}
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services: map[string]refresh.SnapshotService{
			"cluster-a": stubSnapshotService{
				build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
					return successSnapshot, nil
				},
			},
		},
		onFirstSnapshot: func(clusterID string) {
			state := lifecycle.GetState(clusterID)
			if state == ClusterStateLoading || state == ClusterStateLoadingSlow {
				lifecycle.SetState(clusterID, ClusterStateReady)
			}
		},
	}

	_, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)

	// Only the initial SetState should have fired, not a duplicate ready transition.
	events := getEvents()
	require.Len(t, events, 1)
	require.Equal(t, emittedEvent{"cluster-a", "ready", ""}, events[0])
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
		clusterOrder: []string{"cluster-a", "cluster-b"},
		services:     services,
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a,cluster-b|")
	require.Error(t, err)
	require.True(t, refresh.IsPermissionDenied(err))
	require.Nil(t, snap)
}
