package objectcatalog

import (
	"fmt"
	"testing"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/resources/common"
)

// seedAnchorService seeds a catalog service with n pods named pod-000.. in
// "default" (uids uid-000..) plus one Widget custom resource, so anchored
// queries have predictable name-sorted ranks and a filterable foreign kind.
func seedAnchorService(t *testing.T, n int) *Service {
	t.Helper()
	svc := NewService(Dependencies{Common: common.Dependencies{}, ClusterID: "cluster-a"}, nil)
	podDesc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"},
		Namespaced: true,
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
	}
	svc.mu.Lock()
	svc.items = map[string]Summary{}
	for i := 0; i < n; i++ {
		name := fmt.Sprintf("pod-%03d", i)
		svc.items[catalogKey(podDesc, "default", name)] = Summary{
			ClusterID: "cluster-a", Kind: "Pod", Group: "", Version: "v1",
			Resource: "pods", Namespace: "default", Name: name,
			UID: fmt.Sprintf("uid-%03d", i), Scope: ScopeNamespace,
		}
	}
	svc.resources = map[string]resourceDescriptor{podDesc.GVR.String(): podDesc}
	svc.mu.Unlock()
	return svc
}

// An anchored catalog query serves the page-aligned window with exact rank and
// ordinary keyset cursors both ways.
func TestCatalogQueryAnchorServesAlignedPage(t *testing.T) {
	svc := seedAnchorService(t, 45)
	result := svc.Query(QueryOptions{
		Limit: 10,
		Anchor: &QueryAnchor{
			Group: "", Version: "v1", Kind: "Pod",
			Namespace: "default", Name: "pod-027", UID: "uid-027",
		},
	})
	if result.AnchorOutcome == nil || !result.AnchorOutcome.Found {
		t.Fatalf("anchor outcome = %+v, want found", result.AnchorOutcome)
	}
	if result.AnchorOutcome.Rank != 27 {
		t.Fatalf("rank = %d, want 27", result.AnchorOutcome.Rank)
	}
	if result.PageStartRank != 20 {
		t.Fatalf("pageStartRank = %d, want 20", result.PageStartRank)
	}
	if len(result.Items) != 10 || result.Items[0].Name != "pod-020" {
		t.Fatalf("window = %d items starting %q", len(result.Items), result.Items[0].Name)
	}
	if result.PreviousToken == "" || result.ContinueToken == "" {
		t.Fatalf("landing cursors: prev=%q cont=%q", result.PreviousToken, result.ContinueToken)
	}

	// The minted previous token pages back to the previous aligned page.
	back := svc.Query(QueryOptions{Limit: 10, Continue: result.PreviousToken})
	if len(back.Items) != 10 || back.Items[0].Name != "pod-010" {
		t.Fatalf("backward page = %d items starting %q, want pod-010", len(back.Items), back.Items[0].Name)
	}
	if back.AnchorOutcome != nil {
		t.Fatal("cursor page must not carry an anchor outcome")
	}
	if back.PageStartRank != -1 {
		t.Fatalf("cursor page pageStartRank = %d, want -1 (not computed)", back.PageStartRank)
	}
}

// The catalog is the one path that CAN verify identity: an anchor whose UID
// does not match the resolved summary is a recreated object → not-found (the
// first page is served; the frontend shows the reason).
func TestCatalogQueryAnchorUIDMismatchIsNotFound(t *testing.T) {
	svc := seedAnchorService(t, 10)
	result := svc.Query(QueryOptions{
		Limit: 5,
		Anchor: &QueryAnchor{
			Group: "", Version: "v1", Kind: "Pod",
			Namespace: "default", Name: "pod-003", UID: "uid-RECREATED",
		},
	})
	if result.AnchorOutcome == nil || result.AnchorOutcome.Found || result.AnchorOutcome.Filtered {
		t.Fatalf("uid-mismatch outcome = %+v, want not-found", result.AnchorOutcome)
	}
	if len(result.Items) != 5 || result.Items[0].Name != "pod-000" {
		t.Fatalf("uid-mismatch fallback = %d items starting %q, want first page", len(result.Items), result.Items[0].Name)
	}

	// Same anchor WITHOUT a uid resolves fine (uid is optional).
	result = svc.Query(QueryOptions{
		Limit: 5,
		Anchor: &QueryAnchor{
			Group: "", Version: "v1", Kind: "Pod",
			Namespace: "default", Name: "pod-003",
		},
	})
	if result.AnchorOutcome == nil || !result.AnchorOutcome.Found || result.AnchorOutcome.Rank != 3 {
		t.Fatalf("uid-less anchor outcome = %+v, want found rank 3", result.AnchorOutcome)
	}
}

// An anchor excluded by the query's filters reports "filtered" — the engine
// store holds all rows, so the outcome is authoritative.
func TestCatalogQueryAnchorFilteredBySearch(t *testing.T) {
	svc := seedAnchorService(t, 10)
	result := svc.Query(QueryOptions{
		Limit:  5,
		Search: "pod-00", // matches pod-000..pod-009 → excludes nothing at n=10; narrow below
		Anchor: &QueryAnchor{
			Group: "", Version: "v1", Kind: "Pod",
			Namespace: "default", Name: "pod-003",
		},
	})
	if result.AnchorOutcome == nil || !result.AnchorOutcome.Found {
		t.Fatalf("in-search anchor should resolve, got %+v", result.AnchorOutcome)
	}

	result = svc.Query(QueryOptions{
		Limit:  5,
		Search: "pod-001", // excludes pod-003
		Anchor: &QueryAnchor{
			Group: "", Version: "v1", Kind: "Pod",
			Namespace: "default", Name: "pod-003",
		},
	})
	out := result.AnchorOutcome
	if out == nil || out.Found || !out.Filtered {
		t.Fatalf("search-excluded anchor outcome = %+v, want filtered", out)
	}
	if len(result.Items) != 1 || result.Items[0].Name != "pod-001" {
		t.Fatalf("filtered fallback = %+v, want the search's first page", result.Items)
	}
}

// A completely unknown anchor is not-found and serves the first page.
func TestCatalogQueryAnchorNotFound(t *testing.T) {
	svc := seedAnchorService(t, 10)
	result := svc.Query(QueryOptions{
		Limit: 5,
		Anchor: &QueryAnchor{
			Group: "", Version: "v1", Kind: "Pod",
			Namespace: "default", Name: "never-existed",
		},
	})
	out := result.AnchorOutcome
	if out == nil || out.Found || out.Filtered {
		t.Fatalf("unknown anchor outcome = %+v, want not-found", out)
	}
	if len(result.Items) != 5 || result.Items[0].Name != "pod-000" {
		t.Fatalf("not-found fallback = %d items starting %q", len(result.Items), result.Items[0].Name)
	}
}
