package snapshot

import (
	"context"
	"errors"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
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
