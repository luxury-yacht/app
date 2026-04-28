package backend

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
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

func TestAggregateSnapshotServiceNamespaceSnapshotTriggersLifecycleCallback(t *testing.T) {
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
		onNamespaceSnapshot: func(clusterID string) {
			called = append(called, clusterID)
		},
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.Equal(t, []string{"cluster-a"}, called)

	// A later namespace snapshot should trigger the callback again. The lifecycle
	// callback decides whether the cluster currently needs a ready transition.
	snap, err = aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.Equal(t, []string{"cluster-a", "cluster-a"}, called)
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
		onNamespaceSnapshot: func(clusterID string) {
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
		onNamespaceSnapshot: func(clusterID string) {
			callbackFired = true
		},
	}

	_, _ = aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.False(t, callbackFired, "callback must not fire on build failure")
}

func TestAggregateSnapshotServiceLifecycleTransitionsReadyAfterInPlaceRebuild(t *testing.T) {
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
		onNamespaceSnapshot: func(clusterID string) {
			state := lifecycle.GetState(clusterID)
			if state == ClusterStateLoading || state == ClusterStateLoadingSlow {
				lifecycle.SetState(clusterID, ClusterStateReady)
			}
		},
	}

	// Initial namespace snapshot moves loading -> ready.
	_, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.Equal(t, ClusterStateReady, lifecycle.GetState("cluster-a"))

	// Simulate an in-place rebuild for the same cluster ID. Rebuild sets the
	// lifecycle back to loading and aggregate Update replaces the service while
	// keeping the cluster present.
	lifecycle.SetState("cluster-a", ClusterStateLoading)
	aggregate.Update([]string{"cluster-a"}, map[string]*system.Subsystem{
		"cluster-a": &system.Subsystem{
			SnapshotService: stubSnapshotService{
				build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
					return successSnapshot, nil
				},
			},
		},
	})

	_, err = aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a|")
	require.NoError(t, err)
	require.Equal(t, ClusterStateReady, lifecycle.GetState("cluster-a"))

	events := getEvents()
	require.Equal(t, emittedEvent{"cluster-a", "loading", ""}, events[0])
	require.Equal(t, emittedEvent{"cluster-a", "ready", "loading"}, events[1])
	require.Equal(t, emittedEvent{"cluster-a", "loading", "ready"}, events[2])
	require.Equal(t, emittedEvent{"cluster-a", "ready", "loading"}, events[3])
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
		onNamespaceSnapshot: func(clusterID string) {
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
		onNamespaceSnapshot: func(clusterID string) {
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
