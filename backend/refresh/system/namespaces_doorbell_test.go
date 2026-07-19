package system

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
)

// Pins the namespaces doorbell wiring: the notifier's broadcast — wired
// through the SAME helper production uses — invalidates the namespaces
// snapshot cache FIRST and then fans a SourceObject doorbell to the
// subscribers. Without the invalidation the doorbell-triggered refetch is
// served the PRE-change cached snapshot (5s TTL) and the UI never updates —
// the exact field failure: perfect doorbell logs, frozen namespace list.
func TestNamespaceNotifierInvalidatesCacheThenBroadcastsDoorbell(t *testing.T) {
	manager := resourcestream.NewManager(
		nil,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		nil,
		nil,
	)
	selector, err := resourcestream.ParseStreamSelector("c1", "namespaces", "")
	require.NoError(t, err)
	sub, err := manager.SubscribeSelector(selector)
	require.NoError(t, err)

	// A real snapshot service with a counting namespaces builder, its cache
	// primed with the pre-change build.
	reg := domain.New()
	builds := 0
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "namespaces",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			builds++
			return &refresh.Snapshot{
				Domain:  "namespaces",
				Scope:   scope,
				Payload: map[string]int{"build": builds},
			}, nil
		},
	}))
	service := snapshot.NewService(reg, nil, snapshot.ClusterMeta{ClusterID: "c1"})
	manager.SetSnapshotDomainInvalidator(service.InvalidateDomainCache)
	_, err = service.Build(context.Background(), "namespaces", "c1|")
	require.NoError(t, err)
	_, err = service.Build(context.Background(), "namespaces", "c1|")
	require.NoError(t, err)
	require.Equal(t, 1, builds, "cache must serve the second pre-change build")

	notifier := snapshot.NewNamespaceChangeNotifier(nil, snapshot.NewNamespaceWorkloadTracker(nil))
	defer notifier.Stop()
	wireNamespacesDoorbell(notifier, manager, nil)

	notifier.NamespaceChanged()

	deadline := time.After(3 * time.Second)
	select {
	case update := <-sub.Updates:
		require.Equal(t, "namespaces", update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, resourcestream.SourceObject, update.Source)
		require.Equal(t, resourcestream.SignalChanged, update.Signal)
		require.NotEmpty(t, update.Version)
	case <-deadline:
		t.Fatal("expected a namespaces doorbell update")
	}

	// The refetch the doorbell triggers must REBUILD, not replay the cache.
	_, err = service.Build(context.Background(), "namespaces", "c1|")
	require.NoError(t, err)
	require.Equal(t, 2, builds, "the doorbell must have invalidated the cached namespaces snapshot")
}

// The cluster-Ready transition must not depend on a frontend fetch arriving:
// the app attaches an observer that self-builds the namespaces snapshot on
// each pre-Ready doorbell. The observer fires AFTER invalidate+broadcast so a
// self-build always sees post-change data.
func TestNamespacesDoorbellInvokesObserverAfterBroadcast(t *testing.T) {
	manager := resourcestream.NewManager(
		nil,
		nil,
		nil,
		nil,
		snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		nil,
		nil,
	)
	selector, err := resourcestream.ParseStreamSelector("c1", "namespaces", "")
	require.NoError(t, err)
	sub, err := manager.SubscribeSelector(selector)
	require.NoError(t, err)

	reg := domain.New()
	builds := 0
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "namespaces",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			builds++
			return &refresh.Snapshot{
				Domain:  "namespaces",
				Scope:   scope,
				Payload: map[string]int{"build": builds},
			}, nil
		},
	}))
	service := snapshot.NewService(reg, nil, snapshot.ClusterMeta{ClusterID: "c1"})
	manager.SetSnapshotDomainInvalidator(service.InvalidateDomainCache)

	notifier := snapshot.NewNamespaceChangeNotifier(nil, snapshot.NewNamespaceWorkloadTracker(nil))
	defer notifier.Stop()

	observer := &NamespacesDoorbellObserver{}
	observed := make(chan string, 4)
	// Attached AFTER wiring — mirroring the app, which can only build the
	// aggregate service (and thus the readiness hook) once every subsystem
	// exists.
	wireNamespacesDoorbell(notifier, manager, observer)
	observer.Set(func(version, reason string) {
		observed <- version
	})

	notifier.NamespaceChanged()

	deadline := time.After(3 * time.Second)
	var doorbellVersion string
	select {
	case update := <-sub.Updates:
		doorbellVersion = update.Version
	case <-deadline:
		t.Fatal("expected a namespaces doorbell update")
	}

	select {
	case version := <-observed:
		require.Equal(t, doorbellVersion, version,
			"the observer must see the same doorbell version the stream broadcast")
	case <-deadline:
		t.Fatal("expected the doorbell observer to be invoked")
	}
}
