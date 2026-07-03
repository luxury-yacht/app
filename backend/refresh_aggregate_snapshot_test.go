package backend

import (
	"context"
	"fmt"
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

func TestAggregateSnapshotServiceBuildRejectsMultiClusterScope(t *testing.T) {
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				t.Fatalf("multi-cluster snapshot request should not reach a cluster service")
				return nil, nil
			},
		},
		"cluster-b": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				t.Fatalf("multi-cluster snapshot request should not reach a cluster service")
				return nil, nil
			},
		},
	}
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a", "cluster-b"},
		services:     services,
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "clusters=cluster-a,cluster-b|")
	require.Error(t, err)
	require.Contains(t, err.Error(), "single cluster scope")
	require.Nil(t, snap)
}

func TestAggregateSnapshotServiceNamespaceSnapshotTriggersLifecycleCallback(t *testing.T) {
	successSnapshot := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces:     []snapshot.NamespaceSummary{{Name: "default"}},
			WorkloadsReady: true,
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

	snap, err := aggregate.Build(context.Background(), "namespaces", "cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.Equal(t, []string{"cluster-a"}, called)

	// A later namespace snapshot should trigger the callback again. The lifecycle
	// callback decides whether the cluster currently needs a ready transition.
	snap, err = aggregate.Build(context.Background(), "namespaces", "cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.Equal(t, []string{"cluster-a", "cluster-a"}, called)
}

func TestAggregateSnapshotServiceNamespaceSnapshotSkipsCallbackUntilWorkloadsReady(t *testing.T) {
	// A namespace snapshot served BEFORE its pod/workload ingest stores have settled carries
	// WorkloadsReady=false (the lever-A fast paint). The readiness gate must NOT fire on it —
	// otherwise the cluster reports "Ready" before any data has loaded.
	notReady := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces:     []snapshot.NamespaceSummary{{Name: "default"}},
			WorkloadsReady: false,
		},
	}
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return notReady, nil
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

	snap, err := aggregate.Build(context.Background(), "namespaces", "cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.Empty(t, called, "readiness callback must not fire until workloads are ready")
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

	snap, err := aggregate.Build(context.Background(), "cluster-overview", "cluster-a|")
	require.NoError(t, err)
	require.NotNil(t, snap)
	require.False(t, callbackFired, "callback must only fire for namespaces domain")
}

// A permission-denied namespaces domain is a SETTLED answer to "is the
// cluster's data loaded" — there is no namespace list this user may load —
// so the readiness callback MUST fire (while the error still reaches the
// client, which renders the permission message). Without this the cluster
// wedges in "loading" forever: the Ready transition only ever fires from the
// namespaces domain.
func TestAggregateSnapshotServicePermissionDeniedNamespacesStillSignalsReadiness(t *testing.T) {
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return nil, refresh.NewPermissionDeniedError(domain, "core/namespaces")
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

	_, err := aggregate.Build(context.Background(), "namespaces", "cluster-a|")
	require.Error(t, err, "the permission error must still reach the client")
	require.True(t, refresh.IsPermissionDenied(err))
	require.Equal(t, []string{"cluster-a"}, called,
		"permission-denied namespaces must still signal readiness")
}

// The cluster-Ready transition must not depend on a frontend fetch arriving:
// the namespaces doorbell observer self-builds the namespaces snapshot while
// the cluster is loading, and that build's WorkloadsReady payload flips the
// lifecycle to ready — entirely server-side. (Field failure: app opened on
// the Overview view, the frontend never requested a namespaces snapshot, and
// the cluster sat in loading_slow forever.)
func TestNamespacesReadinessSelfBuildFlipsReady(t *testing.T) {
	emitter, _ := collectingEmitter()
	lifecycle := newClusterLifecycleWithSlowThreshold(emitter, time.Minute)
	lifecycle.SetState("cluster-a", ClusterStateLoading)

	builds := 0
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				builds++
				return &refresh.Snapshot{
					Domain: "namespaces",
					Payload: snapshot.NamespaceSnapshot{
						Namespaces:     []snapshot.NamespaceSummary{{Name: "default"}},
						WorkloadsReady: true,
					},
				}, nil
			},
		},
	}
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services:     services,
	}
	// The production wiring: a successful WorkloadsReady namespaces build
	// moves loading/loading_slow to ready.
	aggregate.onNamespaceSnapshot = func(clusterID string) {
		state := lifecycle.GetState(clusterID)
		if state == ClusterStateLoading || state == ClusterStateLoadingSlow {
			lifecycle.SetState(clusterID, ClusterStateReady)
		}
	}

	runNamespacesReadinessSelfBuild(lifecycle, aggregate, "cluster-a")

	require.Equal(t, 1, builds, "the self-build must run the namespaces builder")
	require.Equal(t, ClusterStateReady, lifecycle.GetState("cluster-a"))

	// Once ready (or in any non-loading state), the self-build must be a
	// no-op — no steady-state rebuild per doorbell.
	runNamespacesReadinessSelfBuild(lifecycle, aggregate, "cluster-a")
	require.Equal(t, 1, builds, "no self-build once the cluster is ready")
}

// Transient (non-permission) failures are NOT settled: the callback must not
// fire, so the cluster keeps waiting for a real namespaces build.
func TestAggregateSnapshotServiceFailedBuildDoesNotTriggerCallback(t *testing.T) {
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return nil, fmt.Errorf("apiserver timeout")
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

	_, _ = aggregate.Build(context.Background(), "namespaces", "cluster-a|")
	require.False(t, callbackFired, "callback must not fire on transient build failure")
}

func TestAggregateSnapshotServiceLifecycleTransitionsReadyAfterInPlaceRebuild(t *testing.T) {
	emitter, getEvents := collectingEmitter()
	lifecycle := newClusterLifecycleWithSlowThreshold(emitter, time.Minute)
	lifecycle.SetState("cluster-a", ClusterStateLoading)

	successSnapshot := &refresh.Snapshot{
		Domain: "namespaces",
		Payload: snapshot.NamespaceSnapshot{
			Namespaces:     []snapshot.NamespaceSummary{{Name: "default"}},
			WorkloadsReady: true,
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
	_, err := aggregate.Build(context.Background(), "namespaces", "cluster-a|")
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

	_, err = aggregate.Build(context.Background(), "namespaces", "cluster-a|")
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
			Namespaces:     []snapshot.NamespaceSummary{{Name: "default"}},
			WorkloadsReady: true,
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

	snap, err := aggregate.Build(context.Background(), "namespaces", "cluster-a|")
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
			Namespaces:     []snapshot.NamespaceSummary{{Name: "default"}},
			WorkloadsReady: true,
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

	_, err := aggregate.Build(context.Background(), "namespaces", "cluster-a|")
	require.NoError(t, err)

	// Only the initial SetState should have fired, not a duplicate ready transition.
	events := getEvents()
	require.Len(t, events, 1)
	require.Equal(t, emittedEvent{"cluster-a", "ready", ""}, events[0])
}

func TestAggregateSnapshotServiceBuildReturnsErrorWhenClusterFails(t *testing.T) {
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return nil, refresh.NewPermissionDeniedError(domain, "")
			},
		},
	}
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services:     services,
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "cluster-a|")
	require.Error(t, err)
	require.True(t, refresh.IsPermissionDenied(err))
	require.Nil(t, snap)
}

func TestAggregateSnapshotServiceBuildReturnsErrorWhenClusterUnavailable(t *testing.T) {
	services := map[string]refresh.SnapshotService{
		"cluster-a": stubSnapshotService{
			build: func(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
				return &refresh.Snapshot{Domain: domain, Scope: scope}, nil
			},
		},
	}
	aggregate := &aggregateSnapshotService{
		clusterOrder: []string{"cluster-a"},
		services:     services,
	}

	snap, err := aggregate.Build(context.Background(), "namespaces", "cluster-b|")
	require.Error(t, err)
	require.Contains(t, err.Error(), "no active clusters available")
	require.Nil(t, snap)
}
