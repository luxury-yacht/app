/*
 * backend/objectcatalog/health_test.go
 *
 * Catalog health and eviction tests.
 */

package objectcatalog

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resources/common"
)

// RBAC-denied resources are tracked per sync and exposed through Health so the
// catalog can be distinguished from a genuinely empty cluster.
func TestHealthReportsDeniedResources(t *testing.T) {
	svc := NewService(Dependencies{Common: common.Dependencies{}}, nil)

	svc.recordDeniedResource("widgets.example.com")
	svc.recordDeniedResource("secrets")
	// Per-namespace workers can hit the same denial repeatedly — dedupe.
	svc.recordDeniedResource("secrets")

	health := svc.Health()
	if len(health.DeniedResources) != 2 ||
		health.DeniedResources[0] != "secrets" ||
		health.DeniedResources[1] != "widgets.example.com" {
		t.Fatalf("expected sorted deduped denials, got %v", health.DeniedResources)
	}

	// A new sync resets the set so granted permissions clear the warning.
	svc.resetDeniedResources()
	if denied := svc.Health().DeniedResources; len(denied) != 0 {
		t.Fatalf("expected denials cleared after reset, got %v", denied)
	}
}

func TestPruneMissingRemovesExpired(t *testing.T) {
	now := time.Date(2024, 2, 1, 12, 0, 0, 0, time.UTC)
	deps := Dependencies{Now: func() time.Time { return now }, Common: common.Dependencies{}}
	svc := NewService(deps, &Options{EvictionTTL: time.Minute})

	seen := map[string]time.Time{
		"recent": now,
		"old":    now.Add(-2 * time.Minute),
	}

	svc.pruneMissing(seen)

	if _, ok := seen["old"]; ok {
		t.Fatalf("expected old entry to be pruned")
	}
	if _, ok := seen["recent"]; !ok {
		t.Fatalf("expected recent entry to remain")
	}
}

func TestPruneMissingDisabledTTL(t *testing.T) {
	base := time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)
	svc := NewService(Dependencies{Now: func() time.Time { return base }, Common: common.Dependencies{}}, nil)
	svc.opts.EvictionTTL = 0
	entries := map[string]time.Time{"keep": base.Add(-time.Hour)}
	svc.pruneMissing(entries)
	if len(entries) != 1 {
		t.Fatalf("expected entries unchanged when TTL disabled")
	}
}
