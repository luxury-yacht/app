package snapshot

import (
	"fmt"
	"testing"
)

// BenchmarkPerBuildPageTurn measures one page-2 serve on a per-Build domain at
// 100k rows (plan P6): uncached = today's O(N log N) matcher+store+index
// rebuild per request; cached-quiet = single-slot hit (page turns while source
// version + metric tick unchanged); cached-churn = version bumps every request
// (always a miss — the churning-domain reality, no worse than uncached). The
// win is quiet-domain-only by design.
func BenchmarkPerBuildPageTurn(b *testing.B) {
	const n = 100_000
	items := perBuildCacheItems(n)
	adapter := configTableQueryAdapter()
	schema := configQuerypageSchema()
	first := applyTypedTableQueryViaStore(items, perBuildQuery("name", "asc", ""), adapter, schema)
	pageTurn := perBuildQuery("name", "asc", first.Continue)

	b.Run("uncached", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			page := applyTypedTableQueryViaStore(items, pageTurn, adapter, schema)
			if len(page.Rows) == 0 {
				b.Fatal("empty page")
			}
		}
	})

	b.Run("cached-quiet", func(b *testing.B) {
		cache := &perBuildStoreCache[ConfigSummary]{}
		for i := 0; i < b.N; i++ {
			page := applyTypedTableQueryViaStore(items, pageTurn, adapter, schema,
				withPerBuildCache(cache, "v1"))
			if len(page.Rows) == 0 {
				b.Fatal("empty page")
			}
		}
	})

	b.Run("cached-churn", func(b *testing.B) {
		cache := &perBuildStoreCache[ConfigSummary]{}
		for i := 0; i < b.N; i++ {
			page := applyTypedTableQueryViaStore(items, pageTurn, adapter, schema,
				withPerBuildCache(cache, fmt.Sprintf("v%d", i)))
			if len(page.Rows) == 0 {
				b.Fatal("empty page")
			}
		}
	})
}
