package querypage

import (
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"testing"
)

// Prototype #2 (plan §Risks): the engine's incremental index + facet maintenance
// must equal a from-scratch recompute after ANY sequence of Upsert/Delete — the
// gate against the "delete-old/insert-new key-swap silently corrupts" failure mode
// (Risk #2). A maintained store fed by informer events applies exactly these
// incremental ops, so this is its correctness foundation.

// groundTruth is the naive model: hold every row, recompute each query from scratch
// using the SAME schema extractors the engine uses, so any divergence is the
// engine's incremental maintenance, not a comparison artifact.
type groundTruth struct {
	schema Schema[podRow]
	rows   map[string]podRow
}

func (g *groundTruth) upsert(r podRow)   { g.rows[g.schema.UID(r)] = r }
func (g *groundTruth) delete(uid string) { delete(g.rows, uid) }

func (g *groundTruth) matches(r podRow, q Query) bool {
	for fname, allowed := range q.Filters {
		if len(allowed) == 0 {
			continue
		}
		v := g.schema.Facets[fname](r)
		ok := false
		for _, a := range allowed {
			if v == a {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	if q.Search != "" && !strings.Contains(strings.ToLower(g.schema.SearchText(r)), strings.ToLower(q.Search)) {
		return false
	}
	return true
}

// query returns the full ordered key list for the query, the filtered total, and
// the unfiltered facet counts — matching the engine's Page semantics.
func (g *groundTruth) query(q Query) (keys []string, total int, facets map[string]map[string]int) {
	matched := make([]podRow, 0, len(g.rows))
	for _, r := range g.rows {
		if g.matches(r, q) {
			matched = append(matched, r)
		}
	}
	total = len(matched)

	getVal := g.schema.SortKeys[q.Sort]
	desc := q.Direction == Descending
	sort.Slice(matched, func(i, j int) bool {
		vi, vj := getVal(matched[i]), getVal(matched[j])
		if vi != vj {
			if desc {
				return vi > vj
			}
			return vi < vj
		}
		return g.schema.UID(matched[i]) < g.schema.UID(matched[j]) // tiebreak always ascending
	})
	for _, r := range matched {
		keys = append(keys, g.schema.UID(r))
	}

	facets = map[string]map[string]int{}
	for fname, get := range g.schema.Facets {
		m := map[string]int{}
		for _, r := range g.rows {
			m[get(r)]++
		}
		facets[fname] = m
	}
	return keys, total, facets
}

func equalStrs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestStoreFuzzEquivalentToRecompute(t *testing.T) {
	sorts := []string{"name", "cpu"}
	dirs := []Direction{Ascending, Descending}
	statuses := []string{"Running", "Pending", "Failed"}
	namespaces := []string{"default", "kube-system", "app"}

	for seed := int64(1); seed <= 40; seed++ {
		r := rand.New(rand.NewSource(seed))
		schema := podSchema()
		store := NewStore(schema)
		gt := &groundTruth{schema: schema, rows: map[string]podRow{}}

		for step := 0; step < 800; step++ {
			// Small UID pool → frequent updates (sort-key + facet changes in place)
			// and delete/recreate of the same key — the cases that break a naive
			// incremental index.
			uid := fmt.Sprintf("u%02d", r.Intn(40))
			if r.Intn(5) == 0 {
				store.Delete(uid)
				gt.delete(uid)
			} else {
				row := podRow{
					uid:       uid,
					namespace: namespaces[r.Intn(len(namespaces))],
					name:      fmt.Sprintf("pod-%02d-%d", r.Intn(40), r.Intn(3)),
					status:    statuses[r.Intn(len(statuses))],
					cpu:       int64(r.Intn(10)), // small range → many ties
				}
				store.Upsert(row)
				gt.upsert(row)
			}

			if step%10 != 0 {
				continue
			}

			q := Query{
				ClusterID: "c",
				Signature: fmt.Sprintf("s%d", step),
				Sort:      sorts[r.Intn(len(sorts))],
				Direction: dirs[r.Intn(len(dirs))],
				Limit:     1 + r.Intn(7), // small → forces multi-page cursor walks
			}
			if r.Intn(2) == 0 {
				q.Filters = map[string][]string{"namespace": {namespaces[r.Intn(len(namespaces))]}}
			}
			if r.Intn(3) == 0 {
				q.Search = fmt.Sprintf("pod-%02d", r.Intn(40))
			}

			assertEquivalent(t, store, gt, q, seed, step)
		}
	}
}

func assertEquivalent(t *testing.T, store *Store[podRow], gt *groundTruth, q Query, seed int64, step int) {
	t.Helper()
	var engineKeys []string
	pq := q
	for guard := 0; ; guard++ {
		if guard > 10000 {
			t.Fatalf("seed %d step %d: pagination did not terminate", seed, step)
		}
		page, err := store.Query(pq)
		if err != nil {
			t.Fatalf("seed %d step %d: query: %v", seed, step, err)
		}
		for _, row := range page.Rows {
			engineKeys = append(engineKeys, store.schema.UID(row))
		}
		if page.NextCursor != "" {
			pq.Cursor = page.NextCursor
			continue
		}

		gtKeys, gtTotal, gtFacets := gt.query(q)
		if !equalStrs(engineKeys, gtKeys) {
			t.Fatalf("seed %d step %d sort=%s dir=%s filters=%v search=%q:\n engine keys=%v\n truth  keys=%v",
				seed, step, q.Sort, q.Direction, q.Filters, q.Search, engineKeys, gtKeys)
		}
		if page.Total != gtTotal {
			t.Fatalf("seed %d step %d: total engine=%d truth=%d", seed, step, page.Total, gtTotal)
		}
		for fname, m := range gtFacets {
			if len(page.Facets[fname]) != len(m) {
				t.Fatalf("seed %d step %d: facet %q size engine=%d truth=%d", seed, step, fname, len(page.Facets[fname]), len(m))
			}
			for v, c := range m {
				if page.Facets[fname][v] != c {
					t.Fatalf("seed %d step %d: facet %q val %q engine=%d truth=%d", seed, step, fname, v, page.Facets[fname][v], c)
				}
			}
		}
		return
	}
}
