package snapshot

import (
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// Browse anchor params ride the same scope-string channel as continue; the
// parse captures the scope's cluster id so the anchor's same-cluster rule is
// enforced with the real request cluster.
func TestParseBrowseScopeParsesAnchor(t *testing.T) {
	scope := "cluster-a|anchor.clusterId=cluster-a&anchor.version=v1&anchor.kind=Pod&anchor.namespace=default&anchor.name=web-1&anchor.uid=uid-9"
	opts, err := parseBrowseScope(scope)
	if err != nil {
		t.Fatalf("valid anchor scope failed to parse: %v", err)
	}
	if opts.Anchor == nil || opts.Anchor.Name != "web-1" || opts.Anchor.UID != "uid-9" {
		t.Fatalf("anchor lost in browse parse: %+v", opts.Anchor)
	}

	qo := opts.toQueryOptions()
	if qo.Anchor == nil || qo.Anchor.Name != "web-1" || qo.Anchor.Kind != "Pod" ||
		qo.Anchor.Namespace != "default" || qo.Anchor.UID != "uid-9" || qo.Anchor.Version != "v1" {
		t.Fatalf("anchor lost mapping to catalog options: %+v", qo.Anchor)
	}
}

func TestParseBrowseScopeRejectsInvalidAnchor(t *testing.T) {
	// anchor + continue → mutual exclusion error.
	scope := "cluster-a|continue=tok&anchor.clusterId=cluster-a&anchor.version=v1&anchor.kind=Pod&anchor.name=web-1"
	if _, err := parseBrowseScope(scope); err == nil || !strings.Contains(err.Error(), "mutually exclusive") {
		t.Fatalf("anchor+continue error = %v", err)
	}

	// cross-cluster anchor → validation error against the SCOPE's cluster.
	scope = "cluster-a|anchor.clusterId=cluster-b&anchor.version=v1&anchor.kind=Pod&anchor.name=web-1"
	if _, err := parseBrowseScope(scope); err == nil || !strings.Contains(err.Error(), "cluster") {
		t.Fatalf("cross-cluster anchor error = %v", err)
	}
}

// The catalog snapshot payload carries the anchor result and serve-time rank,
// mapped from the engine outcome with rank 0 kept explicit.
func TestBuildCatalogSnapshotCarriesAnchor(t *testing.T) {
	result := objectcatalog.QueryResult{
		Items:         []objectcatalog.Summary{{Name: "web-1"}},
		TotalItems:    1,
		TotalIsExact:  true,
		AnchorOutcome: &querypage.AnchorOutcome{Found: true, Rank: 0},
		PageStartRank: 0,
	}
	payload, _ := buildCatalogSnapshot(result, browseQueryOptions{Limit: 10}, objectcatalog.HealthStatus{}, true, false)
	if payload.Anchor == nil || !payload.Anchor.Found || payload.Anchor.Rank != 0 {
		t.Fatalf("payload anchor = %+v, want found rank 0", payload.Anchor)
	}
	if payload.PageStartRank == nil || *payload.PageStartRank != 0 {
		t.Fatalf("payload pageStartRank = %v, want explicit 0", payload.PageStartRank)
	}

	// Filtered outcome maps to the user-visible reason.
	result.AnchorOutcome = &querypage.AnchorOutcome{Filtered: true, Rank: -1}
	result.PageStartRank = -1
	payload, _ = buildCatalogSnapshot(result, browseQueryOptions{Limit: 10}, objectcatalog.HealthStatus{}, true, false)
	if payload.Anchor == nil || payload.Anchor.Found || payload.Anchor.Reason != "filtered" {
		t.Fatalf("payload filtered anchor = %+v", payload.Anchor)
	}
	if payload.PageStartRank != nil {
		t.Fatalf("uncomputed pageStartRank leaked: %v", *payload.PageStartRank)
	}

	// No anchor on the request → no anchor on the payload.
	result.AnchorOutcome = nil
	payload, _ = buildCatalogSnapshot(result, browseQueryOptions{Limit: 10}, objectcatalog.HealthStatus{}, true, false)
	if payload.Anchor != nil {
		t.Fatalf("anchor-less payload carries %+v", payload.Anchor)
	}
}
