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

	summary := rec.SnapshotSummary()
	if len(summary.Snapshots) != 1 {
		t.Fatalf("expected one snapshot telemetry entry, got %d", len(summary.Snapshots))
	}
	if summary.Snapshots[0].LastStatus != "success" || summary.Snapshots[0].LastError != "" {
		t.Fatalf("expected successful snapshot telemetry, got %+v", summary.Snapshots[0])
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
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
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

	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
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
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
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

	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
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

	service.permissionChecker = permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
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
	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
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

	checker := permissions.NewCheckerWithReview("cluster-a", 0, func(ctx context.Context, group, resource, verb string) (bool, error) {
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
