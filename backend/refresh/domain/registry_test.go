package domain_test

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

func TestRegistryRegisterAndBuild(t *testing.T) {
	reg := domain.New()
	err := reg.Register(refresh.DomainConfig{
		Name: "sample",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "sample", Version: 1, Payload: map[string]string{"scope": scope}}, nil
		},
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	snap, err := reg.Build(context.Background(), "sample", "test")
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if snap.Domain != "sample" {
		t.Fatalf("unexpected domain %s", snap.Domain)
	}
	if snap.Payload.(map[string]string)["scope"] != "test" {
		t.Fatalf("unexpected payload scope")
	}
}

func TestRegistryDuplicate(t *testing.T) {
	reg := domain.New()
	cfg := refresh.DomainConfig{
		Name: "dup",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "dup"}, nil
		},
	}
	if err := reg.Register(cfg); err != nil {
		t.Fatalf("first register failed: %v", err)
	}
	if err := reg.Register(cfg); err == nil {
		t.Fatalf("expected duplicate registration error")
	}
}

func TestRegistryValidation(t *testing.T) {
	reg := domain.New()
	if err := reg.Register(refresh.DomainConfig{}); err == nil {
		t.Fatalf("expected error for missing name and builder")
	}

	if err := reg.Register(refresh.DomainConfig{Name: "missing-builder"}); err == nil {
		t.Fatalf("expected error for missing builder")
	}

	err := reg.Register(refresh.DomainConfig{
		Name: "ok",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "ok"}, nil
		},
	})
	if err != nil {
		t.Fatalf("expected valid registration: %v", err)
	}
}

func TestRegistryListAndUnknownDomain(t *testing.T) {
	reg := domain.New()
	// register out of order
	for _, name := range []string{"beta", "alpha"} {
		if err := reg.Register(refresh.DomainConfig{
			Name: name,
			BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
				return &refresh.Snapshot{Domain: name}, nil
			},
		}); err != nil {
			t.Fatalf("register %s failed: %v", name, err)
		}
	}

	if _, err := reg.Build(context.Background(), "missing", "scope"); err == nil {
		t.Fatalf("expected error building unknown domain")
	}

	list := reg.List()
	if len(list) != 2 || list[0].Name != "alpha" || list[1].Name != "beta" {
		t.Fatalf("expected sorted list, got %+v", list)
	}
}

func TestManualRefreshFallbackAndHandler(t *testing.T) {
	reg := domain.New()
	reg.Register(refresh.DomainConfig{
		Name: "no-manual",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "no-manual"}, nil
		},
	})
	reg.Register(refresh.DomainConfig{
		Name: "custom",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "custom"}, nil
		},
		ManualRefresh: func(ctx context.Context, scope string) (*refresh.ManualRefreshResult, error) {
			return &refresh.ManualRefreshResult{
				Job: &refresh.ManualRefreshJob{
					Domain: "custom",
					Scope:  scope,
					State:  refresh.JobStateSucceeded,
				},
			}, nil
		},
	})

	if _, err := reg.ManualRefresh(context.Background(), "missing", "ns"); err == nil {
		t.Fatalf("expected error for missing domain")
	}

	res, err := reg.ManualRefresh(context.Background(), "no-manual", "ns")
	if err != nil {
		t.Fatalf("manual refresh fallback error: %v", err)
	}
	if res.Job != nil || res.Error != nil {
		t.Fatalf("expected empty result for nil handler, got %+v", res)
	}

	res, err = reg.ManualRefresh(context.Background(), "custom", "target")
	if err != nil {
		t.Fatalf("manual refresh handler error: %v", err)
	}
	if res.Job == nil || res.Job.Domain != "custom" || res.Job.Scope != "target" || res.Job.State != refresh.JobStateSucceeded {
		t.Fatalf("unexpected manual refresh result %+v", res)
	}
}
