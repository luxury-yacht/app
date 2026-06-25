package querypage

import (
	"fmt"
	"math/rand"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// trigramRow is a row whose searchable Name carries shared trigrams, unicode, and
// substrings of every length, so the trigram search path is exercised against the
// linear-scan oracle across the full term-length spectrum.
type trigramRow struct {
	uid  string
	name string
	ns   string
}

func trigramSchema() Schema[trigramRow] {
	return Schema[trigramRow]{
		UID: func(r trigramRow) string { return r.uid },
		SortKeys: map[string]func(trigramRow) string{
			"name": func(r trigramRow) string { return r.name },
		},
		Facets: map[string]func(trigramRow) string{
			"ns": func(r trigramRow) string { return r.ns },
		},
		SearchText: func(r trigramRow) string { return r.name },
	}
}

// linearOracle is the brute-force ground truth for a search: the UIDs whose lowercased
// name contains the lowercased term, in the engine's sort order (name asc, uid asc tie).
// It uses the SAME schema extractor the engine uses, so any divergence is the trigram
// path, not a comparison artifact.
func linearOracle(rows []trigramRow, term string) []string {
	lower := strings.ToLower(term)
	matched := make([]trigramRow, 0, len(rows))
	for _, r := range rows {
		if lower == "" || strings.Contains(strings.ToLower(r.name), lower) {
			matched = append(matched, r)
		}
	}
	sort.Slice(matched, func(i, j int) bool {
		if matched[i].name != matched[j].name {
			return matched[i].name < matched[j].name
		}
		return matched[i].uid < matched[j].uid
	})
	out := make([]string, len(matched))
	for i, r := range matched {
		out[i] = r.uid
	}
	return out
}

// paginateTrigram drives a query through every page and returns the UIDs in order.
func paginateTrigram(t *testing.T, s *Store[trigramRow], q Query) []string {
	t.Helper()
	var out []string
	for guard := 0; ; guard++ {
		if guard > 10000 {
			t.Fatal("pagination did not terminate")
		}
		page, err := s.Query(q)
		if err != nil {
			t.Fatalf("query: %v", err)
		}
		for _, r := range page.Rows {
			out = append(out, r.uid)
		}
		if page.NextCursor == "" {
			return out
		}
		q.Cursor = page.NextCursor
	}
}

// TestTrigramSearchEqualsLinearOracle proves the trigram-accelerated search path
// returns EXACTLY the same rows + order as a brute-force strings.Contains oracle for a
// variety of search terms: >=3 chars, <3 chars, no-match, substring-in-the-middle,
// unicode, and terms whose trigrams are shared across many rows. It paginates with a
// small limit so the result also proves the page order + cursor walk are unchanged.
func TestTrigramSearchEqualsLinearOracle(t *testing.T) {
	s := NewStore(trigramSchema())
	var rows []trigramRow
	add := func(uid, name string) {
		r := trigramRow{uid: uid, name: name, ns: "default"}
		s.Upsert(r)
		rows = append(rows, r)
	}
	// Shared-trigram families, mid-substrings, repeats, and unicode.
	add("u01", "frontend-alpha")
	add("u02", "frontend-beta")
	add("u03", "frontend-gamma")
	add("u04", "backend-alpha")
	add("u05", "backend-beta")
	add("u06", "cache-redis")
	add("u07", "cache-memcached")
	add("u08", "FrontEnd-UPPER")  // case-insensitivity
	add("u09", "my-frontend-svc") // substring in the middle
	add("u10", "数据库-主节点")         // unicode, multibyte
	add("u11", "数据库-从节点")
	add("u12", "café-latte") // multibyte é
	add("u13", "café-mocha")
	add("u14", "aaa-bbb-ccc") // many repeated trigrams within one name
	add("u15", "ccc-bbb-aaa")
	for i := 0; i < 60; i++ { // bulk rows that share the "pod-" trigram family
		add(fmt.Sprintf("p%03d", i), fmt.Sprintf("pod-%03d-svc", i*7%60))
	}

	terms := []string{
		"frontend", "front", "end", "backend", "cache",
		"alpha", "beta", "redis", "memcached",
		"a", "b", "aa", "cc", // <3 chars: linear fallback
		"zzz", "nomatch", "xyzzy", // no-match
		"my-frontend", "tend-sv", // mid-substring spanning a hyphen
		"数据库", "主节点", "从", "café", "latte", " café-",
		"aaa", "bbb", "ccc", "-bbb-",
		"pod-", "pod-00", "-svc", "07",
		"", // empty search: every row
	}
	for _, sort := range []string{"name"} {
		for _, dir := range []Direction{Ascending, Descending} {
			for _, term := range terms {
				want := linearOracle(rows, term)
				if dir == Descending {
					// Descending value order, uid tiebreak ascending — mirror groundTruth.
					sortDesc := make([]string, len(want))
					copy(sortDesc, want)
					// Re-sort the oracle for descending name order.
					byUID := map[string]trigramRow{}
					for _, r := range rows {
						byUID[r.uid] = r
					}
					matched := make([]trigramRow, 0, len(want))
					for _, uid := range want {
						matched = append(matched, byUID[uid])
					}
					sortRowsDesc(matched)
					for i, r := range matched {
						sortDesc[i] = r.uid
					}
					want = sortDesc
				}
				got := paginateTrigram(t, s, Query{
					ClusterID: "c", Signature: "sig-" + term, Sort: sort, Direction: dir, Limit: 7, Search: term,
				})
				if !equalStrs(got, want) {
					t.Fatalf("term=%q dir=%v:\n got =%v\n want=%v", term, dir, got, want)
				}
			}
		}
	}
}

func sortRowsDesc(rows []trigramRow) {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].name != rows[j].name {
			return rows[i].name > rows[j].name
		}
		return rows[i].uid < rows[j].uid // tiebreak always ascending
	})
}

// TestTrigramRowIDRecyclingDropsStaleTrigrams proves that when a deleted row's rowID is
// recycled by a later Upsert of a NEW uid, the index does not resurrect the old row's
// trigrams: searching for a substring unique to the deleted row must not return the
// recycled row, and searching for the new row's substring must return it.
func TestTrigramRowIDRecyclingDropsStaleTrigrams(t *testing.T) {
	s := NewStore(trigramSchema())
	// Insert one row, delete it (frees its rowID), then insert a new row that recycles
	// the freed rowID (it is the only free slot).
	s.Upsert(trigramRow{uid: "old", name: "zebra-unique-old", ns: "default"})
	s.Delete("old")
	s.Upsert(trigramRow{uid: "new", name: "tiger-fresh-new", ns: "default"})

	// The recycled rowID must NOT carry the deleted row's trigrams.
	if got := paginateTrigram(t, s, Query{ClusterID: "c", Signature: "s1", Sort: "name", Direction: Ascending, Limit: 10, Search: "zebra"}); len(got) != 0 {
		t.Fatalf("stale trigrams leaked: searching deleted row's substring returned %v", got)
	}
	// The new row IS findable via the trigram path.
	got := paginateTrigram(t, s, Query{ClusterID: "c", Signature: "s2", Sort: "name", Direction: Ascending, Limit: 10, Search: "tiger"})
	if !equalStrs(got, []string{"new"}) {
		t.Fatalf("new row not found via trigram search: got %v", got)
	}

	// In-place replace (Upsert of an existing uid) must re-key the trigrams: the old
	// name's unique substring no longer matches; the new one does.
	s.Upsert(trigramRow{uid: "new", name: "lion-renamed", ns: "default"})
	if got := paginateTrigram(t, s, Query{ClusterID: "c", Signature: "s3", Sort: "name", Direction: Ascending, Limit: 10, Search: "tiger"}); len(got) != 0 {
		t.Fatalf("replaced row's old trigrams leaked: searching old substring returned %v", got)
	}
	if got := paginateTrigram(t, s, Query{ClusterID: "c", Signature: "s4", Sort: "name", Direction: Ascending, Limit: 10, Search: "lion"}); !equalStrs(got, []string{"new"}) {
		t.Fatalf("replaced row not found by new substring: got %v", got)
	}
}

// TestTrigramFuzzEqualsLinearOracle is a randomized version: after random Upsert/Delete
// churn (which exercises rowID recycling heavily), a set of random >=3-char and <3-char
// search terms must page identically to the brute-force oracle.
func TestTrigramFuzzEqualsLinearOracle(t *testing.T) {
	syllables := []string{"alpha", "beta", "gamma", "redis", "pod", "svc", "café", "数据", "aa", "bb"}
	makeName := func(r *rand.Rand) string {
		n := 1 + r.Intn(3)
		parts := make([]string, n)
		for i := range parts {
			parts[i] = syllables[r.Intn(len(syllables))]
		}
		return strings.Join(parts, "-")
	}
	for seed := int64(1); seed <= 25; seed++ {
		r := rand.New(rand.NewSource(seed))
		s := NewStore(trigramSchema())
		live := map[string]trigramRow{}
		for step := 0; step < 400; step++ {
			uid := fmt.Sprintf("u%02d", r.Intn(30)) // small pool → frequent replace + recycle
			if r.Intn(5) == 0 {
				s.Delete(uid)
				delete(live, uid)
			} else {
				row := trigramRow{uid: uid, name: makeName(r), ns: "default"}
				s.Upsert(row)
				live[uid] = row
			}
		}
		rows := make([]trigramRow, 0, len(live))
		for _, row := range live {
			rows = append(rows, row)
		}
		// A mix of long terms (trigram path) and short ones (linear fallback), plus no-match.
		terms := []string{makeName(r), syllables[r.Intn(len(syllables))], "a", "bb", "数据", "zzz", ""}
		for _, term := range terms {
			want := linearOracle(rows, term)
			got := paginateTrigram(t, s, Query{ClusterID: "c", Signature: "f-" + term, Sort: "name", Direction: Ascending, Limit: 9, Search: term})
			if !equalStrs(got, want) {
				t.Fatalf("seed %d term=%q:\n got =%v\n want=%v", seed, term, got, want)
			}
		}
	}
}

// TestReadOnlyStoreHasNoTrigramIndexButSearchesCorrectly proves a readOnly store built
// via OpenInternedColumnStore holds NO trigram index (off-heap invariant) yet still
// returns correct search results via the linear fallback.
func TestReadOnlyStoreHasNoTrigramIndexButSearchesCorrectly(t *testing.T) {
	orig := buildSpillStore(t)

	path := filepath.Join(t.TempDir(), "readonly.qcm")
	if err := orig.SpillInternedColumns(path); err != nil {
		t.Fatalf("SpillInternedColumns: %v", err)
	}
	ro, closer, err := OpenInternedColumnStore(path, spillSchema())
	if err != nil {
		t.Fatalf("OpenInternedColumnStore: %v", err)
	}
	defer closer()

	if ro.tri != nil {
		t.Fatal("readOnly mmap-aliased store must hold no trigram index")
	}

	// Search still works via the linear fallback and matches the heap original exactly.
	for _, term := range []string{"pod-0", "pod-01", "00", ""} {
		want, err := orig.Query(Query{ClusterID: "c", Signature: "ro-" + term, Sort: "name", Direction: Ascending, Limit: 1000, Search: term})
		if err != nil {
			t.Fatalf("orig.Query: %v", err)
		}
		got, err := ro.Query(Query{ClusterID: "c", Signature: "ro-" + term, Sort: "name", Direction: Ascending, Limit: 1000, Search: term})
		if err != nil {
			t.Fatalf("ro.Query: %v", err)
		}
		if want.Total != got.Total {
			t.Fatalf("term=%q total mismatch: heap=%d readOnly=%d", term, want.Total, got.Total)
		}
		if len(want.Rows) != len(got.Rows) {
			t.Fatalf("term=%q row count mismatch: heap=%d readOnly=%d", term, len(want.Rows), len(got.Rows))
		}
		for i := range want.Rows {
			if want.Rows[i].UID != got.Rows[i].UID {
				t.Fatalf("term=%q row %d uid mismatch: heap=%q readOnly=%q", term, i, want.Rows[i].UID, got.Rows[i].UID)
			}
		}
	}
}

// TestReopenInPlaceClearsTrigramIndex proves the in-place Cold transition also drops the
// trigram index (the swapped-in store is readOnly and off-heap).
func TestReopenInPlaceClearsTrigramIndex(t *testing.T) {
	orig := buildSpillStore(t)
	if orig.tri == nil {
		t.Fatal("a heap store should build a trigram index")
	}
	path := filepath.Join(t.TempDir(), "inplace-tri.qcm")
	closer, err := orig.ReopenInternedColumnsInPlace(path)
	if err != nil {
		t.Fatalf("ReopenInternedColumnsInPlace: %v", err)
	}
	defer closer()
	if orig.tri != nil {
		t.Fatal("in-place Cold transition must clear the trigram index")
	}
}
