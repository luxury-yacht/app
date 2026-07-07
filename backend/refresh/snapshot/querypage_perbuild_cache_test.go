package snapshot

import (
	"fmt"
	"testing"
)

func perBuildCacheItems(n int) []ConfigSummary {
	items := make([]ConfigSummary, n)
	for i := 0; i < n; i++ {
		kind := "ConfigMap"
		if i%3 == 0 {
			kind = "Secret"
		}
		items[i] = ConfigSummary{
			Kind:      kind,
			Name:      fmt.Sprintf("cfg-%03d", i),
			Namespace: "default",
		}
	}
	return items
}

func perBuildQuery(sortField, dir, cont string) typedTableQuery {
	return typedTableQuery{
		Enabled:   true,
		BaseScope: "namespace:default",
		Request: ResourceQueryRequest{
			ClusterID: "c", Table: "namespace-config",
			SortField: sortField, SortDirection: dir, Limit: 20,
			Continue: cont,
		},
	}
}

// A page turn (same matched set, same version) must reuse the cached store —
// the F6 fix: no O(N log N) rebuild per cursor request. Sort/direction changes
// also hit (the store carries every schema sort index).
func TestPerBuildCacheReusesStoreAcrossPageTurnsAndSorts(t *testing.T) {
	items := perBuildCacheItems(95)
	cache := &perBuildStoreCache[ConfigSummary]{}
	adapter := configTableQueryAdapter()
	schema := configQuerypageSchema()

	page1 := applyTypedTableQueryViaStore(items, perBuildQuery("name", "asc", ""), adapter, schema,
		withPerBuildCache(cache, "v1"))
	if cache.store == nil {
		t.Fatal("miss did not publish the built store")
	}
	built := cache.store

	page2 := applyTypedTableQueryViaStore(items, perBuildQuery("name", "asc", page1.Continue), adapter, schema,
		withPerBuildCache(cache, "v1"))
	if cache.store != built {
		t.Fatal("page turn rebuilt the store (cache miss)")
	}
	if len(page2.Rows) != 20 || page2.Rows[0].Name != "cfg-020" {
		t.Fatalf("cached page 2 = %d rows starting %q", len(page2.Rows), page2.Rows[0].Name)
	}
	if page2.Total != page1.Total || page2.UnfilteredTotal != 95 {
		t.Fatalf("cached totals: total=%d unfiltered=%d", page2.Total, page2.UnfilteredTotal)
	}

	// Sort flip: same matched set → hit.
	desc := applyTypedTableQueryViaStore(items, perBuildQuery("name", "desc", ""), adapter, schema,
		withPerBuildCache(cache, "v1"))
	if cache.store != built {
		t.Fatal("sort change rebuilt the store; the key must exclude sort/direction")
	}
	if desc.Rows[0].Name != "cfg-094" {
		t.Fatalf("desc first row = %q", desc.Rows[0].Name)
	}
}

// Version token, metric revision, and matched-set inputs each invalidate.
func TestPerBuildCacheInvalidates(t *testing.T) {
	items := perBuildCacheItems(30)
	cache := &perBuildStoreCache[ConfigSummary]{}
	adapter := configTableQueryAdapter()
	schema := configQuerypageSchema()

	applyTypedTableQueryViaStore(items, perBuildQuery("name", "asc", ""), adapter, schema,
		withPerBuildCache(cache, "v1"))
	built := cache.store

	// Source version bump → rebuild.
	applyTypedTableQueryViaStore(items, perBuildQuery("name", "asc", ""), adapter, schema,
		withPerBuildCache(cache, "v2"))
	if cache.store == built {
		t.Fatal("version bump did not invalidate")
	}
	built = cache.store

	// Metric tick (DynamicRevision) → rebuild: overlaid metric values feed the
	// sort indexes, so a stale store would freeze metric sort order.
	tick := perBuildQuery("name", "asc", "")
	tick.DynamicRevision = "metrics-2"
	applyTypedTableQueryViaStore(items, tick, adapter, schema, withPerBuildCache(cache, "v2"))
	if cache.store == built {
		t.Fatal("metric revision did not invalidate")
	}
	built = cache.store

	// Filter change → different matched set → rebuild.
	filtered := perBuildQuery("name", "asc", "")
	filtered.Request.Kinds = []string{"Secret"}
	page := applyTypedTableQueryViaStore(items, filtered, adapter, schema, withPerBuildCache(cache, "v2"))
	if cache.store == built {
		t.Fatal("kind filter did not invalidate")
	}
	if page.Total != 10 {
		t.Fatalf("filtered total = %d, want 10 Secrets", page.Total)
	}
}

// Cached serves must be byte-equivalent to fresh builds — pages, totals, and
// facets — across sorts and cursors.
func TestPerBuildCacheServesIdenticalPagesToFreshBuild(t *testing.T) {
	items := perBuildCacheItems(60)
	cache := &perBuildStoreCache[ConfigSummary]{}
	adapter := configTableQueryAdapter()
	schema := configQuerypageSchema()

	for _, sort := range []string{"name", "kind"} {
		for _, dir := range []string{"asc", "desc"} {
			cont := ""
			for page := 0; page < 4; page++ {
				q := perBuildQuery(sort, dir, cont)
				fresh := applyTypedTableQueryViaStore(items, q, adapter, schema)
				cached := applyTypedTableQueryViaStore(items, q, adapter, schema,
					withPerBuildCache(cache, "v1"))
				if len(fresh.Rows) != len(cached.Rows) {
					t.Fatalf("%s/%s page %d: row count fresh=%d cached=%d", sort, dir, page, len(fresh.Rows), len(cached.Rows))
				}
				for i := range fresh.Rows {
					if adapter.Key(fresh.Rows[i]) != adapter.Key(cached.Rows[i]) {
						t.Fatalf("%s/%s page %d row %d: fresh=%q cached=%q", sort, dir, page, i,
							adapter.Key(fresh.Rows[i]), adapter.Key(cached.Rows[i]))
					}
				}
				if fresh.Total != cached.Total || fresh.UnfilteredTotal != cached.UnfilteredTotal ||
					fresh.Continue != cached.Continue || fresh.Previous != cached.Previous {
					t.Fatalf("%s/%s page %d: envelope divergence", sort, dir, page)
				}
				if fmt.Sprint(fresh.Kinds) != fmt.Sprint(cached.Kinds) ||
					fmt.Sprint(fresh.Namespaces) != fmt.Sprint(cached.Namespaces) {
					t.Fatalf("%s/%s page %d: facet divergence", sort, dir, page)
				}
				cont = fresh.Continue
				if cont == "" {
					break
				}
			}
		}
	}
}
