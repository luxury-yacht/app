package snapshot

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

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
	service := NewService(reg, rec, ClusterMeta{})

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
	service := NewService(reg, rec, ClusterMeta{})

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

	service := NewService(reg, nil, ClusterMeta{})

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

	service := NewService(reg, nil, ClusterMeta{})
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

		service := NewService(reg, nil, ClusterMeta{})
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
		if resource == "configmaps" && verb == "list" {
			return false, nil
		}
		return true, nil
	})
	service := NewServiceWithPermissions(reg, nil, ClusterMeta{}, checker)

	if _, err := service.Build(context.Background(), namespaceConfigDomainName, "scope-a"); err == nil {
		t.Fatalf("expected permission error")
	} else if !refresh.IsPermissionDenied(err) {
		t.Fatalf("expected permission denied error, got %v", err)
	}
	if called {
		t.Fatalf("expected snapshot builder to be skipped on permission denial")
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
	service := NewServiceWithPermissions(reg, nil, ClusterMeta{}, checker)

	if _, err := service.Build(context.Background(), namespaceConfigDomainName, "scope-a"); err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	if !called {
		t.Fatalf("expected snapshot builder to run when permissions allow")
	}
}
