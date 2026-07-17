/*
 * backend/refresh/snapshot/service_test.go
 *
 * Exercises snapshot service behavior around build dispatch, caching,
 * permission handling, and the required cluster identity contract.
 */

package snapshot

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

func testClusterMeta() ClusterMeta {
	return ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"}
}

type fakeInformerHub struct {
	mu      sync.RWMutex
	synced  bool
	pending map[string]bool
}

func (h *fakeInformerHub) Start(context.Context) error { return nil }

func (h *fakeInformerHub) HasSynced(context.Context) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.synced
}

// ResourcesSettled mirrors the factory semantics: a key blocks only while
// explicitly marked pending; unknown keys are settled.
func (h *fakeInformerHub) ResourcesSettled(keys []string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, key := range keys {
		if h.pending[key] {
			return false
		}
	}
	return true
}

func (h *fakeInformerHub) Shutdown() error { return nil }

func (h *fakeInformerHub) setSynced(synced bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.synced = synced
}

func (h *fakeInformerHub) setPending(key string, pending bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.pending == nil {
		h.pending = make(map[string]bool)
	}
	h.pending[key] = pending
}

// TestServiceSetInformerHubSwapsSyncGate proves the cool path can swap a Service's informer
// hub at runtime: a Build gated by a NOT-yet-synced hub starts blocked, then once
// SetInformerHub installs an always-synced hub (the cooled-cluster contract — its frozen data
// is resident, so the sync gate must report settled immediately), the same Build proceeds.
// The swap and the in-flight Build's hub read run concurrently, so -race proves no data race.
func TestServiceSetInformerHubSwapsSyncGate(t *testing.T) {
	reg := domain.New()
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "demo",
		BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "demo", Scope: scope}, nil
		},
	}))

	pending := &fakeInformerHub{} // synced == false: the sync gate stays closed
	service := NewService(reg, telemetry.NewRecorder(), testClusterMeta()).WithInformerHub(pending)
	service.informerSyncTimeout = time.Second

	done := make(chan error, 1)
	go func() {
		_, err := service.Build(context.Background(), "demo", "scope-a")
		done <- err
	}()

	// The Build must still be blocked on the unsynced hub's gate.
	select {
	case err := <-done:
		t.Fatalf("Build returned %v before the hub reported synced", err)
	case <-time.After(20 * time.Millisecond):
	}

	// Swap in a cooled hub that always reports synced — concurrently with the in-flight Build.
	service.SetInformerHub(alwaysSyncedHub{})

	select {
	case err := <-done:
		require.NoError(t, err, "Build proceeds once a synced hub is installed")
	case <-time.After(2 * time.Second):
		t.Fatal("Build did not proceed after SetInformerHub installed a synced hub")
	}
}

// alwaysSyncedHub is the cooled-cluster readiness gate: frozen data is resident, so it
// reports settled immediately and its lifecycle methods are no-ops.
type alwaysSyncedHub struct{}

func (alwaysSyncedHub) Start(context.Context) error    { return nil }
func (alwaysSyncedHub) HasSynced(context.Context) bool { return true }
func (alwaysSyncedHub) ResourcesSettled([]string) bool { return true }
func (alwaysSyncedHub) Shutdown() error                { return nil }

// TestServiceBuildRecordsInformerSyncWait proves a Build that blocks in the informer
// sync gate (the initial-LIST gating cost) records the wait it paid as the domain's
// MaxInformerSyncWaitMs telemetry, so the cold-start cost is visible in diagnostics.
func TestServiceBuildRecordsInformerSyncWait(t *testing.T) {
	reg := domain.New()
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "demo",
		BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "demo", Scope: scope}, nil
		},
	}))

	recorder := telemetry.NewRecorder()
	hub := &fakeInformerHub{} // synced == false: the sync gate stays closed
	service := NewService(reg, recorder, testClusterMeta()).WithInformerHub(hub)
	service.informerSyncTimeout = 2 * time.Second

	done := make(chan error, 1)
	go func() {
		_, err := service.Build(context.Background(), "demo", "scope-a")
		done <- err
	}()

	// Let the Build block in the sync gate, then release it.
	time.Sleep(120 * time.Millisecond)
	hub.setSynced(true)

	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("Build did not complete after the hub reported synced")
	}

	summary := recorder.SnapshotSummary()
	require.Len(t, summary.Snapshots, 1)
	require.GreaterOrEqual(t, summary.Snapshots[0].MaxInformerSyncWaitMs, int64(100),
		"the ~120ms sync-gate wait must be recorded as MaxInformerSyncWaitMs")
}

// TestServiceDoesNotCacheNotReadyNamespaceSnapshots pins the cache rule for the fast
// namespace paint: a snapshot built BEFORE the workload ingest stores settle
// (WorkloadsReady=false) must not be cached — the TTL would pin the pre-sync flags and
// delay the cluster Ready flip by up to cache TTL + poll. Once ready, caching resumes.
func TestServiceDoesNotCacheNotReadyNamespaceSnapshots(t *testing.T) {
	reg := domain.New()
	builds := 0
	ready := false
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "namespaces",
		BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
			builds++
			return &refresh.Snapshot{
				Domain:  "namespaces",
				Scope:   scope,
				Payload: NamespaceSnapshot{WorkloadsReady: ready},
			}, nil
		},
	}))
	service := NewService(reg, nil, testClusterMeta())

	for i := 0; i < 2; i++ {
		_, err := service.Build(context.Background(), "namespaces", "cluster-a|")
		require.NoError(t, err)
	}
	require.Equal(t, 2, builds, "not-ready namespace snapshots must not be served from cache")

	ready = true
	for i := 0; i < 2; i++ {
		_, err := service.Build(context.Background(), "namespaces", "cluster-a|")
		require.NoError(t, err)
	}
	require.Equal(t, 3, builds, "ready namespace snapshots must be cached again")
}

func TestServiceBuildEmitsSequenceAndChecksum(t *testing.T) {
	reg := domain.New()
	if err := reg.Register(refresh.DomainConfig{
		Name: "demo",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{
				Domain: "demo",
				Scope:  scope,
				Payload: map[string]string{
					"hello": "world",
				},
				Stats: refresh.SnapshotStats{TotalItems: 1},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	rec := telemetry.NewRecorder()
	service := NewService(reg, rec, testClusterMeta())

	snap, err := service.Build(context.Background(), "demo", "scope-a")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if snap.Sequence == 0 || snap.GeneratedAt == 0 {
		t.Fatalf("expected sequence and generatedAt to be set, got %#v", snap)
	}
	if snap.Checksum == "" {
		t.Fatalf("expected checksum to be set")
	}
	if snap.SourceVersion == "" {
		t.Fatalf("expected sourceVersion to be set")
	}
	require.Equal(t, "0", snap.SourceVersions["object"])

	summary := rec.SnapshotSummary()
	if len(summary.Snapshots) != 1 {
		t.Fatalf("expected one snapshot telemetry entry, got %d", len(summary.Snapshots))
	}
	if summary.Snapshots[0].LastStatus != "success" || summary.Snapshots[0].LastError != "" {
		t.Fatalf("expected successful snapshot telemetry, got %+v", summary.Snapshots[0])
	}
}

func TestServiceSourceVersionIncludesEpoch(t *testing.T) {
	reg := domain.New()
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "demo",
		BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{
				Domain:  "demo",
				Scope:   scope,
				Version: 3,
				Payload: map[string]string{
					"hello": "world",
				},
			}, nil
		},
	}))

	serviceA := NewService(reg, nil, testClusterMeta())
	serviceB := NewService(reg, nil, testClusterMeta())
	serviceA.epoch = "epoch-a"
	serviceB.epoch = "epoch-b"

	first, err := serviceA.Build(context.Background(), "demo", "scope-a")
	require.NoError(t, err)
	second, err := serviceB.Build(context.Background(), "demo", "scope-a")
	require.NoError(t, err)

	require.NotEmpty(t, first.SourceVersion)
	require.NotEmpty(t, second.SourceVersion)
	require.NotEqual(t, first.SourceVersion, second.SourceVersion)
	require.Equal(t, first.SourceVersions, second.SourceVersions)
}

// Versionless snapshot domains such as object-map still need a payload-sensitive
// validator. Otherwise a changed graph keeps the same source version and the
// conditional snapshot request returns 304 with deleted objects still visible.
func TestServiceVersionlessPayloadChangeAdvancesSourceVersion(t *testing.T) {
	reg := domain.New()
	jobCount := 1
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name: "object-map",
		BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{
				Domain:  "object-map",
				Scope:   scope,
				Version: 0,
				Payload: map[string]int{"jobCount": jobCount},
			}, nil
		},
	}))

	service := NewService(reg, nil, testClusterMeta())
	service.cacheTTL = 0

	first, err := service.Build(context.Background(), "object-map", "cluster-a|namespace:default")
	require.NoError(t, err)
	jobCount = 0
	second, err := service.Build(context.Background(), "object-map", "cluster-a|namespace:default")
	require.NoError(t, err)
	third, err := service.Build(context.Background(), "object-map", "cluster-a|namespace:default")
	require.NoError(t, err)

	require.NotEqual(t, first.Checksum, second.Checksum)
	require.NotEqual(t, first.SourceVersion, second.SourceVersion)
	require.Equal(t, second.Checksum, third.Checksum)
	require.Equal(t, second.SourceVersion, third.SourceVersion)
}

func TestServiceDoesNotCacheMetricSourceDomains(t *testing.T) {
	for _, domainName := range []string{
		"pods",
		"namespace-workloads",
		"nodes",
	} {
		t.Run(domainName, func(t *testing.T) {
			reg := domain.New()
			builds := 0
			require.NoError(t, reg.Register(refresh.DomainConfig{
				Name: domainName,
				BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
					builds++
					return &refresh.Snapshot{
						Domain: domainName,
						Scope:  scope,
						SourceVersions: map[string]string{
							"metric": time.Unix(0, int64(builds)).Format(time.RFC3339Nano),
						},
						Payload: map[string]int{"builds": builds},
					}, nil
				},
			}))

			service := NewService(reg, nil, testClusterMeta())
			first, err := service.Build(context.Background(), domainName, "namespace:default")
			require.NoError(t, err)
			second, err := service.Build(context.Background(), domainName, "namespace:default")
			require.NoError(t, err)

			require.Equal(t, 2, builds)
			require.NotEqual(t, first.SourceVersions["metric"], second.SourceVersions["metric"])
		})
	}
}

func TestServiceBuildWaitsForInformerSyncBeforeBuilding(t *testing.T) {
	reg := domain.New()
	built := make(chan struct{})
	if err := reg.Register(refresh.DomainConfig{
		Name: "nodes",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			close(built)
			return &refresh.Snapshot{
				Domain:  "nodes",
				Scope:   scope,
				Payload: map[string][]string{"nodes": {"node-a"}},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	hub := &fakeInformerHub{}
	service := NewService(reg, nil, testClusterMeta()).WithInformerHub(hub)
	done := make(chan error, 1)
	go func() {
		_, err := service.Build(context.Background(), "nodes", "")
		done <- err
	}()

	select {
	case <-built:
		t.Fatal("snapshot built before informer caches synced")
	case err := <-done:
		t.Fatalf("Build returned before informer caches synced: %v", err)
	case <-time.After(config.RefreshInformerSyncPollInterval * 2):
	}

	hub.setSynced(true)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Build returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Build did not complete after informer caches synced")
	}
}

func TestServiceBuildFailsWhenInformerSyncTimesOut(t *testing.T) {
	reg := domain.New()
	built := false
	if err := reg.Register(refresh.DomainConfig{
		Name: "nodes",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			built = true
			return &refresh.Snapshot{Domain: "nodes", Scope: scope}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	rec := telemetry.NewRecorder()
	hub := &fakeInformerHub{}
	service := NewService(reg, rec, testClusterMeta()).WithInformerHub(hub)
	service.informerSyncTimeout = 50 * time.Millisecond

	done := make(chan error, 1)
	go func() {
		_, err := service.Build(context.Background(), "nodes", "")
		done <- err
	}()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected informer sync timeout error")
		}
		if !errors.Is(err, errInformerSyncTimeout) {
			t.Fatalf("expected informer sync timeout error, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Build hung past the informer sync timeout")
	}

	if built {
		t.Fatal("snapshot builder must not run when informer caches never sync")
	}

	summary := rec.SnapshotSummary()
	if len(summary.Snapshots) != 1 {
		t.Fatalf("expected one telemetry entry for the sync timeout, got %d", len(summary.Snapshots))
	}
	if summary.Snapshots[0].LastStatus != "error" || summary.Snapshots[0].LastError == "" {
		t.Fatalf("expected error telemetry for the sync timeout, got %+v", summary.Snapshots[0])
	}
}

func registerEchoDomain(t *testing.T, reg *domain.Registry, name string) {
	t.Helper()
	if err := reg.Register(refresh.DomainConfig{
		Name: name,
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: name, Scope: scope, Payload: map[string]string{"domain": name}}, nil
		},
	}); err != nil {
		t.Fatalf("register %s failed: %v", name, err)
	}
}

func TestServiceBuildGatesOnDeclaredDomainResources(t *testing.T) {
	reg := domain.New()
	registerEchoDomain(t, reg, "nodes")
	registerEchoDomain(t, reg, "pods")
	registerEchoDomain(t, reg, "catalog")

	hub := &fakeInformerHub{}
	hub.setPending("core/pods", true)
	// Factory-wide flag stays false the whole test: mapped domains must not
	// consult it.
	service := NewService(reg, nil, testClusterMeta()).
		WithInformerHub(hub).
		WithDomainReadiness(map[string][]string{
			"nodes":   {"core/nodes"},
			"pods":    {"core/pods"},
			"catalog": {},
		})
	service.informerSyncTimeout = 50 * time.Millisecond

	// A domain whose declared resources are settled builds immediately even
	// while an unrelated informer is pending and the factory-wide flag is false.
	if _, err := service.Build(context.Background(), "nodes", ""); err != nil {
		t.Fatalf("nodes build should not wait on unrelated informers: %v", err)
	}

	// A mapped domain with no informer dependencies never waits.
	if _, err := service.Build(context.Background(), "catalog", ""); err != nil {
		t.Fatalf("catalog build with no declared resources should not wait: %v", err)
	}

	// A domain whose own resource is pending still times out.
	if _, err := service.Build(context.Background(), "pods", ""); !errors.Is(err, errInformerSyncTimeout) {
		t.Fatalf("expected pods build to fail with informer sync timeout, got %v", err)
	}

	// Once its own resource settles, the domain builds.
	hub.setPending("core/pods", false)
	if _, err := service.Build(context.Background(), "pods", ""); err != nil {
		t.Fatalf("pods build should succeed once its resource settles: %v", err)
	}
}

func TestServiceBuildUnmappedDomainKeepsFactoryWideGate(t *testing.T) {
	reg := domain.New()
	registerEchoDomain(t, reg, "object-yaml")

	hub := &fakeInformerHub{}
	service := NewService(reg, nil, testClusterMeta()).
		WithInformerHub(hub).
		WithDomainReadiness(map[string][]string{"nodes": {"core/nodes"}})
	service.informerSyncTimeout = 50 * time.Millisecond

	// Domains without a readiness declaration keep today's conservative
	// factory-wide gate.
	if _, err := service.Build(context.Background(), "object-yaml", ""); !errors.Is(err, errInformerSyncTimeout) {
		t.Fatalf("expected unmapped domain to keep the factory-wide gate, got %v", err)
	}

	hub.setSynced(true)
	if _, err := service.Build(context.Background(), "object-yaml", ""); err != nil {
		t.Fatalf("unmapped domain should build once the factory reports synced: %v", err)
	}
}

func TestServiceBuildRequiresClusterIdentity(t *testing.T) {
	reg := domain.New()
	if err := reg.Register(refresh.DomainConfig{
		Name: "demo",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "demo", Scope: scope}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	service := NewService(reg, nil, ClusterMeta{})
	if _, err := service.Build(context.Background(), "demo", "scope-a"); err == nil {
		t.Fatalf("expected missing cluster identity error")
	}
}

func TestServiceBuildRecordsFailure(t *testing.T) {
	reg := domain.New()
	if err := reg.Register(refresh.DomainConfig{
		Name: "demo-fail",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return nil, errors.New("boom")
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	rec := telemetry.NewRecorder()
	service := NewService(reg, rec, testClusterMeta())

	if _, err := service.Build(context.Background(), "demo-fail", "scope-b"); err == nil {
		t.Fatalf("expected build error")
	}

	summary := rec.SnapshotSummary()
	if len(summary.Snapshots) != 1 {
		t.Fatalf("expected failure telemetry entry")
	}
	if summary.Snapshots[0].LastStatus != "error" || summary.Snapshots[0].LastError == "" {
		t.Fatalf("expected error telemetry, got %+v", summary.Snapshots[0])
	}
}

func TestServiceBuildCachesAndBypasses(t *testing.T) {
	reg := domain.New()
	buildCount := 0
	if err := reg.Register(refresh.DomainConfig{
		Name: "demo-cache",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			buildCount++
			return &refresh.Snapshot{
				Domain:  "demo-cache",
				Scope:   scope,
				Payload: map[string]int{"items": buildCount},
				Stats:   refresh.SnapshotStats{TotalItems: 1},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	service := NewService(reg, nil, testClusterMeta())

	snap1, err := service.Build(context.Background(), "demo-cache", "scope-a")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	snap2, err := service.Build(context.Background(), "demo-cache", "scope-a")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	if buildCount != 1 {
		t.Fatalf("expected cached snapshot to reuse build, got %d builds", buildCount)
	}
	if snap1.Sequence != snap2.Sequence {
		t.Fatalf("expected cached snapshot to preserve sequence")
	}

	snap3, err := service.Build(refresh.WithCacheBypass(context.Background()), "demo-cache", "scope-a")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if buildCount != 2 {
		t.Fatalf("expected cache bypass to rebuild snapshot, got %d builds", buildCount)
	}
	if snap3.Sequence == snap2.Sequence {
		t.Fatalf("expected cache bypass to issue a new sequence")
	}
}

// The doorbell notifiers invalidate their domain's cache BEFORE broadcasting:
// the doorbell-triggered refetch arrives ~500ms after the change — inside the
// 5s cache TTL — and without invalidation it would be served the PRE-change
// snapshot, permanently (doorbells fire once; polls skip while streaming).
func TestServiceInvalidateDomainCacheForcesRebuild(t *testing.T) {
	reg := domain.New()
	builds := map[string]int{}
	register := func(name string) {
		if err := reg.Register(refresh.DomainConfig{
			Name: name,
			BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
				builds[name]++
				return &refresh.Snapshot{
					Domain:  name,
					Scope:   scope,
					Payload: map[string]int{"build": builds[name]},
					Stats:   refresh.SnapshotStats{TotalItems: 1},
				}, nil
			},
		}); err != nil {
			t.Fatalf("register %s failed: %v", name, err)
		}
	}
	register("demo-doorbell")
	register("demo-other")

	service := NewService(reg, nil, testClusterMeta())

	for _, name := range []string{"demo-doorbell", "demo-other"} {
		if _, err := service.Build(context.Background(), name, "scope-a"); err != nil {
			t.Fatalf("Build %s returned error: %v", name, err)
		}
		if _, err := service.Build(context.Background(), name, "scope-a"); err != nil {
			t.Fatalf("Build %s returned error: %v", name, err)
		}
		if builds[name] != 1 {
			t.Fatalf("%s: expected cached snapshot to reuse build, got %d builds", name, builds[name])
		}
	}

	service.InvalidateDomainCache("demo-doorbell")

	if _, err := service.Build(context.Background(), "demo-doorbell", "scope-a"); err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if builds["demo-doorbell"] != 2 {
		t.Fatalf("expected invalidation to force a rebuild, got %d builds", builds["demo-doorbell"])
	}

	// Another domain's cache entries stay untouched.
	if _, err := service.Build(context.Background(), "demo-other", "scope-a"); err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if builds["demo-other"] != 1 {
		t.Fatalf("expected other domain to stay cached, got %d builds", builds["demo-other"])
	}
}

func TestServiceBuildDoesNotCacheObjectMaintenance(t *testing.T) {
	reg := domain.New()
	buildCount := 0
	if err := reg.Register(refresh.DomainConfig{
		Name: "object-maintenance",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			buildCount++
			return &refresh.Snapshot{
				Domain:  "object-maintenance",
				Scope:   scope,
				Payload: map[string]int{"items": buildCount},
				Stats:   refresh.SnapshotStats{TotalItems: 1},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	service := NewService(reg, nil, testClusterMeta())
	snap1, err := service.Build(context.Background(), "object-maintenance", "cluster-a|node:worker-1")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	snap2, err := service.Build(context.Background(), "object-maintenance", "cluster-a|node:worker-1")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	if buildCount != 2 {
		t.Fatalf("expected object-maintenance to bypass cache, got %d builds", buildCount)
	}
	if snap1.Sequence == snap2.Sequence {
		t.Fatalf("expected object-maintenance rebuild to issue a new sequence")
	}
}

func TestServiceBuildDoesNotSingleflightObjectMaintenance(t *testing.T) {
	reg := domain.New()
	started := make(chan struct{})
	release := make(chan struct{})
	var mu sync.Mutex
	callCount := 0

	if err := reg.Register(refresh.DomainConfig{
		Name: "object-maintenance",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			mu.Lock()
			callCount++
			count := callCount
			mu.Unlock()
			if count == 1 {
				close(started)
				<-release
			}
			return &refresh.Snapshot{
				Domain:  "object-maintenance",
				Scope:   scope,
				Version: uint64(count),
				Payload: map[string]int{"items": count},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	service := NewService(reg, nil, testClusterMeta())
	ctx := context.Background()

	done := make(chan struct{})
	go func() {
		_, _ = service.Build(ctx, "object-maintenance", "cluster-a|node:worker-1")
		close(done)
	}()

	<-started
	snap, err := service.Build(ctx, "object-maintenance", "cluster-a|node:worker-1")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	close(release)
	<-done

	if snap.Version != 2 {
		t.Fatalf("expected second object-maintenance build to run independently, got version %d", snap.Version)
	}
	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected object-maintenance to avoid singleflight join, got %d calls", callCount)
	}
}

func TestServiceBuildBypassUsesSeparateSingleflightKey(t *testing.T) {
	reg := domain.New()
	started := make(chan struct{})
	release := make(chan struct{})
	var mu sync.Mutex
	callCount := 0

	if err := reg.Register(refresh.DomainConfig{
		Name: "demo-bypass",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			mu.Lock()
			callCount++
			count := callCount
			mu.Unlock()
			if count == 1 {
				close(started)
				<-release
			}
			return &refresh.Snapshot{
				Domain:  "demo-bypass",
				Scope:   scope,
				Version: uint64(count),
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	service := NewService(reg, nil, testClusterMeta())
	ctx := context.Background()

	done := make(chan struct{})
	go func() {
		_, _ = service.Build(ctx, "demo-bypass", "scope-a")
		close(done)
	}()

	<-started
	if _, err := service.Build(refresh.WithCacheBypass(ctx), "demo-bypass", "scope-a"); err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	close(release)
	<-done

	mu.Lock()
	defer mu.Unlock()
	if callCount != 2 {
		t.Fatalf("expected bypass build to avoid singleflight join, got %d calls", callCount)
	}
}

func TestServiceBuildSkipsCacheForPartialSnapshots(t *testing.T) {
	cases := []struct {
		name  string
		stats refresh.SnapshotStats
	}{
		{
			name:  "truncated",
			stats: refresh.SnapshotStats{Truncated: true},
		},
		{
			name:  "non-final-batch",
			stats: refresh.SnapshotStats{TotalBatches: 2, IsFinalBatch: false},
		},
	}

	for _, testCase := range cases {
		reg := domain.New()
		buildCount := 0
		if err := reg.Register(refresh.DomainConfig{
			Name: "demo-partial-" + testCase.name,
			BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
				buildCount++
				return &refresh.Snapshot{
					Domain:  "demo-partial-" + testCase.name,
					Scope:   scope,
					Payload: map[string]int{"items": buildCount},
					Stats:   testCase.stats,
				}, nil
			},
		}); err != nil {
			t.Fatalf("register failed: %v", err)
		}

		service := NewService(reg, nil, testClusterMeta())
		if _, err := service.Build(context.Background(), "demo-partial-"+testCase.name, "scope-a"); err != nil {
			t.Fatalf("Build returned error: %v", err)
		}
		if _, err := service.Build(context.Background(), "demo-partial-"+testCase.name, "scope-a"); err != nil {
			t.Fatalf("Build returned error: %v", err)
		}
		if buildCount != 2 {
			t.Fatalf("expected partial snapshot to bypass cache, got %d builds", buildCount)
		}
	}
}

func TestServiceBuildBlocksPermissionDenied(t *testing.T) {
	reg := domain.New()
	called := false
	// Use a real domain name so the default permission map is applied.
	// namespace-config uses ModeAny, so we must deny ALL resources to trigger denial.
	if err := reg.Register(refresh.DomainConfig{
		Name: namespaceConfigDomainName,
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			called = true
			return &refresh.Snapshot{
				Domain: namespaceConfigDomainName,
				Scope:  scope,
				Stats:  refresh.SnapshotStats{TotalItems: 1},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	// Deny all resources in the namespace-config domain (configmaps + secrets).
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		return false, nil
	})
	service := NewServiceWithPermissions(reg, nil, testClusterMeta(), checker)

	if _, err := service.Build(context.Background(), namespaceConfigDomainName, "scope-a"); err == nil {
		t.Fatalf("expected permission error")
	} else if !refresh.IsPermissionDenied(err) {
		t.Fatalf("expected permission denied error, got %v", err)
	}
	if called {
		t.Fatalf("expected snapshot builder to be skipped on permission denial")
	}
}

func TestServiceBuildBlocksNamespacesWithoutListPermission(t *testing.T) {
	reg := domain.New()
	called := false
	if err := reg.Register(refresh.DomainConfig{
		Name: "namespaces",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			called = true
			return &refresh.Snapshot{
				Domain: "namespaces",
				Scope:  scope,
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		if group == "" && resource == "namespaces" && verb == "list" {
			return false, nil
		}
		return true, nil
	})
	service := NewServiceWithPermissions(reg, nil, testClusterMeta(), checker)

	if _, err := service.Build(context.Background(), "namespaces", "cluster-a|"); err == nil {
		t.Fatalf("expected permission error")
	} else if !refresh.IsPermissionDenied(err) {
		t.Fatalf("expected permission denied error, got %v", err)
	}
	if called {
		t.Fatalf("expected namespaces builder to be skipped on permission denial")
	}
}

func TestServiceBuildAllowsPartialPermissions(t *testing.T) {
	reg := domain.New()
	called := false
	// namespace-config uses ModeAny — if at least one resource is allowed, the domain should load.
	if err := reg.Register(refresh.DomainConfig{
		Name: namespaceConfigDomainName,
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			called = true
			return &refresh.Snapshot{
				Domain: namespaceConfigDomainName,
				Scope:  scope,
				Stats:  refresh.SnapshotStats{TotalItems: 1},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	// Deny configmaps but allow secrets.
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		if resource == "configmaps" && verb == "list" {
			return false, nil
		}
		return true, nil
	})
	service := NewServiceWithPermissions(reg, nil, testClusterMeta(), checker)

	if _, err := service.Build(context.Background(), namespaceConfigDomainName, "scope-a"); err != nil {
		t.Fatalf("expected partial permissions to allow build, got: %v", err)
	}
	if !called {
		t.Fatalf("expected snapshot builder to run with partial permissions")
	}
}

func TestServiceBuildKeysCacheByRuntimeAllowedResources(t *testing.T) {
	reg := domain.New()
	buildCount := 0
	if err := reg.Register(refresh.DomainConfig{
		Name: namespaceConfigDomainName,
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			buildCount++
			allowed, ok := domainpermissions.AllowedResourcesFromContext(ctx, namespaceConfigDomainName)
			if !ok {
				t.Fatalf("expected runtime allowed resources in snapshot context")
			}
			return &refresh.Snapshot{
				Domain: namespaceConfigDomainName,
				Scope:  scope,
				Payload: map[string]bool{
					"configmaps": allowed.Allows("", "configmaps"),
					"secrets":    allowed.Allows("", "secrets"),
				},
				Stats: refresh.SnapshotStats{TotalItems: 1},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		return resource == "configmaps" || resource == "secrets", nil
	})
	service := NewServiceWithPermissions(reg, nil, testClusterMeta(), checker)

	first, err := service.Build(context.Background(), namespaceConfigDomainName, "cluster-a|namespace:default")
	if err != nil {
		t.Fatalf("first build failed: %v", err)
	}
	firstPayload := first.Payload.(map[string]bool)
	if !firstPayload["configmaps"] || !firstPayload["secrets"] {
		t.Fatalf("expected first build to allow both resources, got %#v", firstPayload)
	}

	service.permissionChecker = permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		return resource == "secrets", nil
	})
	second, err := service.Build(context.Background(), namespaceConfigDomainName, "cluster-a|namespace:default")
	if err != nil {
		t.Fatalf("second build failed: %v", err)
	}
	secondPayload := second.Payload.(map[string]bool)
	if secondPayload["configmaps"] || !secondPayload["secrets"] {
		t.Fatalf("expected second build to reflect revoked configmap access, got %#v", secondPayload)
	}
	if buildCount != 2 {
		t.Fatalf("expected permission-specific cache keys to force a rebuild, got %d builds", buildCount)
	}
}

func TestServiceBuildSkipsEnsureForPermissionDeniedDomain(t *testing.T) {
	reg := domain.New()
	// Register a permission-denied placeholder domain.
	if err := RegisterPermissionDeniedDomain(reg, namespaceConfigDomainName, "core/configmaps,secrets"); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	reviewCalled := false
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		reviewCalled = true
		return false, nil
	})
	service := NewServiceWithPermissions(reg, nil, testClusterMeta(), checker)

	// Build should return PermissionDeniedError from the placeholder's BuildSnapshot,
	// NOT from ensurePermissions (which should be skipped).
	_, err := service.Build(context.Background(), namespaceConfigDomainName, "scope-a")
	if err == nil {
		t.Fatalf("expected permission error from placeholder domain")
	}
	if !refresh.IsPermissionDenied(err) {
		t.Fatalf("expected permission denied error, got %v", err)
	}
	// The SSAR review function should NOT have been called because ensurePermissions
	// short-circuits for permission-denied domains.
	if reviewCalled {
		t.Fatalf("expected SSAR review to be skipped for permission-denied placeholder domain")
	}
}

func TestServiceBuildAllowsWhenPermissionsSucceed(t *testing.T) {
	reg := domain.New()
	called := false
	// Use a real domain name so the default permission map is applied.
	if err := reg.Register(refresh.DomainConfig{
		Name: namespaceConfigDomainName,
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			called = true
			return &refresh.Snapshot{
				Domain: namespaceConfigDomainName,
				Scope:  scope,
				Stats:  refresh.SnapshotStats{TotalItems: 1},
			}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb, _ string) (bool, error) {
		return true, nil
	})
	service := NewServiceWithPermissions(reg, nil, testClusterMeta(), checker)

	if _, err := service.Build(context.Background(), namespaceConfigDomainName, "scope-a"); err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !called {
		t.Fatalf("expected snapshot builder to run when permissions allow")
	}
}

// The scoped namespaces domain (docs/plans/namespace-scope.md) serves
// synthesized rows and needs NO cluster permission — the per-request policy
// gate must honor the registration's exemption. This is the live-observed
// failure: the scoped domain was registered and serving, but every fetch got
// a fresh 403 from ensurePermissions, so the sidebar never left the
// permission-denied state.
func TestServiceBuildServesRuntimePolicyExemptDomainForDeniedIdentity(t *testing.T) {
	reg := domain.New()
	called := false
	if err := reg.Register(refresh.DomainConfig{
		Name:                "namespaces",
		RuntimePolicyExempt: true,
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			called = true
			return &refresh.Snapshot{Domain: "namespaces", Scope: scope}, nil
		},
	}); err != nil {
		t.Fatalf("register failed: %v", err)
	}

	// The restricted persona: every cluster-wide ask denied.
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(context.Context, string, string, string, string) (bool, error) {
		return false, nil
	})
	service := NewServiceWithPermissions(reg, nil, testClusterMeta(), checker)

	snap, err := service.Build(context.Background(), "namespaces", "cluster-a|")
	if err != nil {
		t.Fatalf("exempt domain must serve despite a fully denied identity: %v", err)
	}
	if snap == nil || !called {
		t.Fatalf("expected the builder to run (called=%v, snap=%v)", called, snap)
	}
}
