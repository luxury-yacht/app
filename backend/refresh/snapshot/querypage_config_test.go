package snapshot

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// makeConfigRows builds varied ConfigSummary rows with deliberate ties on kind,
// namespace, and data so the tiebreak (row key) is exercised in both directions.
func makeConfigRows(n int) []ConfigSummary {
	kinds := []string{"ConfigMap", "Secret"}
	namespaces := []string{"default", "kube-system", "app"}
	rows := make([]ConfigSummary, n)
	for i := 0; i < n; i++ {
		rows[i] = ConfigSummary{
			Kind:         kinds[i%len(kinds)],
			Name:         fmt.Sprintf("cfg-%03d", i), // unique -> unique row key
			Namespace:    namespaces[i%len(namespaces)],
			Data:         (i * 13) % 7, // many ties
			Age:          fmt.Sprintf("%dm", i%5),
			AgeTimestamp: int64(1_000_000 + (i%9)*1000), // ties, non-zero so NumericSort engages
		}
	}
	return rows
}

// TestConfigQuerypageMatchesTypedTableOrder proves the querypage engine paginates in
// exactly the live typed-table total order (typedTableSortedItemLess) for every sort
// field and direction, ties included — the keystone for an invisible cutover.
func TestConfigQuerypageMatchesTypedTableOrder(t *testing.T) {
	adapter := configTableQueryAdapter()
	rows := makeConfigRows(200)
	store := querypage.NewStore(configQuerypageSchema())
	for _, r := range rows {
		store.Upsert(r)
	}

	for _, field := range []string{"name", "kind", "namespace", "data", "age"} {
		for _, dir := range []querypage.Direction{querypage.Ascending, querypage.Descending} {
			desc := dir == querypage.Descending

			// Ground truth: the exact live total order.
			gt := append([]ConfigSummary{}, rows...)
			sort.SliceStable(gt, func(i, j int) bool {
				vi := typedTableComparableSortValue(gt[i], field, adapter)
				vj := typedTableComparableSortValue(gt[j], field, adapter)
				if vi != vj {
					if desc {
						return vi > vj
					}
					return vi < vj
				}
				return adapter.Key(gt[i]) < adapter.Key(gt[j]) // tiebreak always ascending
			})

			// Engine: paginate the whole set in small pages via cursors.
			q := querypage.Query{ClusterID: "c", Signature: "sig", Sort: field, Direction: dir, Limit: 17}
			var got []ConfigSummary
			for guard := 0; ; guard++ {
				if guard > 1000 {
					t.Fatalf("%s/%s: pagination did not terminate", field, dir)
				}
				page, err := store.Query(q)
				if err != nil {
					t.Fatalf("%s/%s: query: %v", field, dir, err)
				}
				got = append(got, page.Rows...)
				if page.NextCursor == "" {
					break
				}
				q.Cursor = page.NextCursor
			}

			if len(got) != len(gt) {
				t.Fatalf("%s/%s: paginated %d rows, want %d", field, dir, len(got), len(gt))
			}
			for i := range got {
				if adapter.Key(got[i]) != adapter.Key(gt[i]) {
					t.Fatalf("%s/%s: order mismatch at %d: engine=%s live=%s",
						field, dir, i, adapter.Key(got[i]), adapter.Key(gt[i]))
				}
			}
		}
	}
}

// TestConfigQuerypageFacetsMatchKinds checks the facet counts the engine maintains
// against a direct tally.
func TestConfigQuerypageFacetsMatchKinds(t *testing.T) {
	rows := makeConfigRows(120)
	store := querypage.NewStore(configQuerypageSchema())
	for _, r := range rows {
		store.Upsert(r)
	}
	page, err := store.Query(querypage.Query{ClusterID: "c", Signature: "s", Sort: "name", Direction: querypage.Ascending, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{}
	for _, r := range rows {
		want[strings.ToLower(r.Kind)]++
	}
	for k, c := range want {
		if page.Facets["kind"][k] != c {
			t.Fatalf("facet kind=%s = %d, want %d", k, page.Facets["kind"][k], c)
		}
	}
}

// TestConfigQueryViaStoreEquivalent is the full-envelope cutover gate: the
// engine-backed serve path must produce the SAME page as the live applyTypedTableQuery
// — identical rows across full pagination, totals, and facet value lists — for a broad
// matrix of sorts × directions × namespace/kind filters × searches.
func TestConfigQueryViaStoreEquivalent(t *testing.T) {
	adapter := configTableQueryAdapter()
	items := makeConfigRows(250)

	paginate := func(serve func(typedTableQuery) typedTableQueryPage[ConfigSummary], base typedTableQuery) ([]string, typedTableQueryPage[ConfigSummary]) {
		q := base
		var keys []string
		var first typedTableQueryPage[ConfigSummary]
		for i := 0; ; i++ {
			if i > 1000 {
				t.Fatal("pagination did not terminate")
			}
			page := serve(q)
			if i == 0 {
				first = page
			}
			for _, r := range page.Rows {
				keys = append(keys, adapter.Key(r))
			}
			if page.Continue == "" {
				break
			}
			q.Request.Continue = page.Continue
		}
		return keys, first
	}

	type filt struct {
		ns     []string
		kinds  []string
		search string
	}
	sorts := []string{"", "name", "kind", "namespace", "data", "age"}
	dirs := []string{"asc", "desc"}
	filts := []filt{
		{},
		{ns: []string{"default"}},
		{ns: []string{"default", "app"}},
		{kinds: []string{"Secret"}},
		{ns: []string{"kube-system"}, kinds: []string{"ConfigMap"}},
		{search: "cfg-01"},
		{search: "secret"},
	}

	for _, sf := range sorts {
		for _, d := range dirs {
			for _, f := range filts {
				base := typedTableQuery{
					Enabled: true,
					Request: ResourceQueryRequest{
						ClusterID: "c", SortField: sf, SortDirection: d, Limit: 17,
						Namespaces: f.ns, Kinds: f.kinds, Search: f.search,
					},
				}
				liveKeys, liveFirst := paginate(func(q typedTableQuery) typedTableQueryPage[ConfigSummary] {
					return applyTypedTableQuery(items, q, adapter)
				}, base)
				engineKeys, engineFirst := paginate(func(q typedTableQuery) typedTableQueryPage[ConfigSummary] {
					return applyTypedTableQueryViaStore(items, q, adapter, configQuerypageSchema())
				}, base)

				label := fmt.Sprintf("sort=%q dir=%s ns=%v kinds=%v search=%q", sf, d, f.ns, f.kinds, f.search)
				if !slices.Equal(liveKeys, engineKeys) {
					t.Fatalf("%s: row sequence differs (live=%d engine=%d rows)", label, len(liveKeys), len(engineKeys))
				}
				if liveFirst.Total != engineFirst.Total {
					t.Fatalf("%s: total live=%d engine=%d", label, liveFirst.Total, engineFirst.Total)
				}
				if liveFirst.UnfilteredTotal != engineFirst.UnfilteredTotal {
					t.Fatalf("%s: unfilteredTotal live=%d engine=%d", label, liveFirst.UnfilteredTotal, engineFirst.UnfilteredTotal)
				}
				if !slices.Equal(liveFirst.Namespaces, engineFirst.Namespaces) {
					t.Fatalf("%s: namespace facets live=%v engine=%v", label, liveFirst.Namespaces, engineFirst.Namespaces)
				}
				if !slices.Equal(liveFirst.Kinds, engineFirst.Kinds) {
					t.Fatalf("%s: kind facets live=%v engine=%v", label, liveFirst.Kinds, engineFirst.Kinds)
				}
			}
		}
	}
}
