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
