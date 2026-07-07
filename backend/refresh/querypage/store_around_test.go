package querypage

import (
	"fmt"
	"math/rand"
	"testing"
)

// storeOfN builds a store with n pods named pod-0000..pod-<n-1> (uid u<i>),
// alternating namespaces so filter cases have both matching and excluded rows.
func storeOfN(t *testing.T, n int) *Store[podRow] {
	t.Helper()
	s := NewStore(podSchema())
	for i := 0; i < n; i++ {
		ns := "default"
		if i%3 == 0 {
			ns = "kube-system"
		}
		s.Upsert(podRow{
			uid:       fmt.Sprintf("u%04d", i),
			namespace: ns,
			name:      fmt.Sprintf("pod-%04d", i),
			status:    "Running",
			cpu:       int64(i),
		})
	}
	return s
}

func nameQuery(limit int) Query {
	return Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: limit}
}

func rowKeys(s *Store[podRow], rows []podRow) []string {
	keys := make([]string, len(rows))
	for i, r := range rows {
		keys[i] = s.schema.UID(r)
	}
	return keys
}

// The plan's worked example: page size 50, 300 matches, anchor at rank 137 →
// the page covering ranks 100–149, anchor at window offset 37, normal keyset
// cursors both ways.
func TestQueryAroundServesAlignedWindow(t *testing.T) {
	s := storeOfN(t, 300)
	q := nameQuery(50)
	page, outcome, err := s.QueryAround(q, "u0137")
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Found || outcome.Filtered {
		t.Fatalf("anchor not found: %+v", outcome)
	}
	if outcome.Rank != 137 {
		t.Fatalf("rank = %d, want 137", outcome.Rank)
	}
	if page.PageStartRank != 100 {
		t.Fatalf("PageStartRank = %d, want 100", page.PageStartRank)
	}
	if len(page.Rows) != 50 || page.Rows[0].name != "pod-0100" || page.Rows[49].name != "pod-0149" {
		t.Fatalf("window = %d rows [%s .. %s], want 50 [pod-0100 .. pod-0149]",
			len(page.Rows), firstName(page.Rows), page.Rows[len(page.Rows)-1].name)
	}
	if page.Rows[37].name != "pod-0137" {
		t.Fatalf("anchor not at window offset 37: %s", page.Rows[37].name)
	}
	if page.PrevCursor == "" || page.NextCursor == "" {
		t.Fatalf("mid-list window must mint both cursors (prev=%q next=%q)", page.PrevCursor, page.NextCursor)
	}
	if page.Total != 300 {
		t.Fatalf("total = %d, want 300", page.Total)
	}

	// Alignment invariant: ◀ from the landing is exactly the page covering
	// ranks 50–99, byte-identical to paging forward from page 1.
	qb := q
	qb.Cursor = page.PrevCursor
	back, err := s.Query(qb)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Rows) != 50 || back.Rows[0].name != "pod-0050" || back.Rows[49].name != "pod-0099" {
		t.Fatalf("prev page = [%s .. %s], want [pod-0050 .. pod-0099]",
			firstName(back.Rows), back.Rows[len(back.Rows)-1].name)
	}
}

func TestQueryAroundFirstAndLastPage(t *testing.T) {
	s := storeOfN(t, 95)
	q := nameQuery(20)

	// Rank 3 → first page, no prev.
	page, outcome, err := s.QueryAround(q, "u0003")
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Rank != 3 || page.PageStartRank != 0 {
		t.Fatalf("rank=%d pageStart=%d, want 3/0", outcome.Rank, page.PageStartRank)
	}
	if page.PrevCursor != "" {
		t.Fatal("first page minted a prev cursor")
	}
	if page.NextCursor == "" {
		t.Fatal("first page of 95 minted no next cursor")
	}

	// Rank 94 → last partial page (80–94), no next.
	page, outcome, err = s.QueryAround(q, "u0094")
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Rank != 94 || page.PageStartRank != 80 {
		t.Fatalf("rank=%d pageStart=%d, want 94/80", outcome.Rank, page.PageStartRank)
	}
	if len(page.Rows) != 15 {
		t.Fatalf("last page rows = %d, want 15", len(page.Rows))
	}
	if page.NextCursor != "" {
		t.Fatal("last page minted a next cursor")
	}
	if page.PrevCursor == "" {
		t.Fatal("last page minted no prev cursor")
	}
}

func TestQueryAroundSoleMatchAndLimitOne(t *testing.T) {
	s := storeOfN(t, 10)
	q := nameQuery(5)
	// Search narrows to exactly one row.
	q.Search = "pod-0007"
	page, outcome, err := s.QueryAround(q, "u0007")
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Found || outcome.Rank != 0 || page.PageStartRank != 0 {
		t.Fatalf("sole match: %+v pageStart=%d", outcome, page.PageStartRank)
	}
	if len(page.Rows) != 1 || page.PrevCursor != "" || page.NextCursor != "" {
		t.Fatalf("sole match page: %d rows prev=%q next=%q", len(page.Rows), page.PrevCursor, page.NextCursor)
	}

	// Limit 1: every rank is its own aligned page.
	q = nameQuery(1)
	page, outcome, err = s.QueryAround(q, "u0004")
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Rank != 4 || page.PageStartRank != 4 || len(page.Rows) != 1 {
		t.Fatalf("limit-1: rank=%d pageStart=%d rows=%d", outcome.Rank, page.PageStartRank, len(page.Rows))
	}
	if page.Rows[0].name != "pod-0004" {
		t.Fatalf("limit-1 row = %s", page.Rows[0].name)
	}
}

func TestQueryAroundDescending(t *testing.T) {
	s := storeOfN(t, 100)
	q := nameQuery(10)
	q.Direction = Descending
	// Descending by name: rank 0 is pod-0099. Anchor pod-0095 → rank 4, page 0.
	page, outcome, err := s.QueryAround(q, "u0095")
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Rank != 4 || page.PageStartRank != 0 {
		t.Fatalf("desc rank=%d pageStart=%d, want 4/0", outcome.Rank, page.PageStartRank)
	}
	if page.Rows[0].name != "pod-0099" || page.Rows[4].name != "pod-0095" {
		t.Fatalf("desc window starts %s with anchor at %s", page.Rows[0].name, page.Rows[4].name)
	}
}

func TestQueryAroundMissingAndFilteredAnchor(t *testing.T) {
	s := storeOfN(t, 60)
	q := nameQuery(20)

	// Absent key → not found, first page anyway.
	page, outcome, err := s.QueryAround(q, "no-such-row")
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Found || outcome.Filtered {
		t.Fatalf("absent anchor outcome: %+v", outcome)
	}
	if page.PageStartRank != 0 || len(page.Rows) != 20 || page.Rows[0].name != "pod-0000" {
		t.Fatalf("absent anchor did not serve the first page: start=%d rows=%d", page.PageStartRank, len(page.Rows))
	}
	if page.PrevCursor != "" || page.NextCursor == "" {
		t.Fatalf("first-page fallback cursors: prev=%q next=%q", page.PrevCursor, page.NextCursor)
	}

	// Row exists but the namespace filter excludes it (u0001 is in "default";
	// filter to kube-system) → filtered, first page of the FILTERED set.
	q.Filters = map[string][]string{"namespace": {"kube-system"}}
	page, outcome, err = s.QueryAround(q, "u0001")
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Found || !outcome.Filtered {
		t.Fatalf("filtered anchor outcome: %+v", outcome)
	}
	if len(page.Rows) == 0 || page.Rows[0].namespace != "kube-system" {
		t.Fatalf("filtered fallback page wrong: %d rows first ns %q", len(page.Rows), page.Rows[0].namespace)
	}
}

func TestQueryAtServesOffsetPageAndClamps(t *testing.T) {
	s := storeOfN(t, 95)
	q := nameQuery(20)

	page, err := s.QueryAt(q, 40)
	if err != nil {
		t.Fatal(err)
	}
	if page.PageStartRank != 40 || len(page.Rows) != 20 || page.Rows[0].name != "pod-0040" {
		t.Fatalf("offset page: start=%d rows=%d first=%s", page.PageStartRank, len(page.Rows), firstName(page.Rows))
	}
	if page.PrevCursor == "" || page.NextCursor == "" {
		t.Fatal("mid-list offset page must mint both cursors")
	}

	// Beyond the end → clamp to the last aligned page (80–94).
	page, err = s.QueryAt(q, 500)
	if err != nil {
		t.Fatal(err)
	}
	if page.PageStartRank != 80 || len(page.Rows) != 15 || page.NextCursor != "" {
		t.Fatalf("clamped page: start=%d rows=%d next=%q", page.PageStartRank, len(page.Rows), page.NextCursor)
	}

	// Negative → first page.
	page, err = s.QueryAt(q, -3)
	if err != nil {
		t.Fatal(err)
	}
	if page.PageStartRank != 0 || page.Rows[0].name != "pod-0000" {
		t.Fatalf("negative startRank: start=%d first=%s", page.PageStartRank, firstName(page.Rows))
	}

	// Empty matched set → empty page, no cursors.
	q.Search = "no-such-pod"
	page, err = s.QueryAt(q, 40)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 0 || page.PageStartRank != 0 || page.NextCursor != "" || page.PrevCursor != "" {
		t.Fatalf("empty set page: %+v", page)
	}
}

// Fuzz: QueryAround must agree with the brute oracle on rank, aligned window,
// and outcome for random stores/filters/searches/sorts/directions/limits — and
// the minted cursors must continue to BOTH ends reproducing the oracle's full
// key list exactly (the "indistinguishable from arrived-by-clicking" contract).
func TestQueryAroundFuzzEquivalentToRecompute(t *testing.T) {
	statuses := []string{"Running", "Pending", "Failed"}
	namespaces := []string{"default", "kube-system", "app"}
	sorts := []string{"name", "cpu"}
	dirs := []Direction{Ascending, Descending}

	for seed := int64(1); seed <= 25; seed++ {
		r := rand.New(rand.NewSource(seed))
		schema := podSchema()
		store := NewStore(schema)
		gt := &groundTruth{schema: schema, rows: map[string]podRow{}}

		for step := 0; step < 400; step++ {
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
					cpu:       int64(r.Intn(10)),
				}
				store.Upsert(row)
				gt.upsert(row)
			}
			if step%20 != 0 {
				continue
			}

			q := Query{
				ClusterID: "c",
				Signature: fmt.Sprintf("s%d", step),
				Sort:      sorts[r.Intn(len(sorts))],
				Direction: dirs[r.Intn(len(dirs))],
				Limit:     1 + r.Intn(7),
			}
			if r.Intn(2) == 0 {
				q.Filters = map[string][]string{"namespace": {namespaces[r.Intn(len(namespaces))]}}
			}
			if r.Intn(3) == 0 {
				q.Search = fmt.Sprintf("pod-%02d", r.Intn(40))
			}

			// Anchor mix: existing uid (matching or not) vs guaranteed-absent.
			anchor := fmt.Sprintf("u%02d", r.Intn(40))
			if r.Intn(4) == 0 {
				anchor = "absent-uid"
			}

			assertAroundEquivalent(t, store, gt, q, anchor, seed, step)
		}
	}
}

func assertAroundEquivalent(t *testing.T, store *Store[podRow], gt *groundTruth, q Query, anchor string, seed int64, step int) {
	t.Helper()
	gtKeys, gtTotal, _ := gt.query(q)
	limit := q.Limit

	page, outcome, err := store.QueryAround(q, anchor)
	if err != nil {
		t.Fatalf("seed %d step %d: QueryAround: %v", seed, step, err)
	}
	if page.Total != gtTotal {
		t.Fatalf("seed %d step %d: total engine=%d truth=%d", seed, step, page.Total, gtTotal)
	}

	// Oracle rank + expected window.
	rank := -1
	for i, k := range gtKeys {
		if k == anchor {
			rank = i
			break
		}
	}
	wantStart := 0
	if rank >= 0 {
		if !outcome.Found || outcome.Filtered {
			t.Fatalf("seed %d step %d: outcome %+v for matching anchor", seed, step, outcome)
		}
		if outcome.Rank != rank {
			t.Fatalf("seed %d step %d: rank engine=%d truth=%d", seed, step, outcome.Rank, rank)
		}
		wantStart = rank - rank%limit
	} else {
		if outcome.Found {
			t.Fatalf("seed %d step %d: found=true for non-matching anchor", seed, step)
		}
		_, present := gt.rows[anchor]
		wantFiltered := present // present in store but not in gtKeys ⇒ excluded by filters/search
		if outcome.Filtered != wantFiltered {
			t.Fatalf("seed %d step %d: filtered engine=%v truth=%v", seed, step, outcome.Filtered, wantFiltered)
		}
	}
	if page.PageStartRank != wantStart {
		t.Fatalf("seed %d step %d: pageStart engine=%d truth=%d", seed, step, page.PageStartRank, wantStart)
	}
	wantEnd := wantStart + limit
	if wantEnd > len(gtKeys) {
		wantEnd = len(gtKeys)
	}
	if !equalStrs(rowKeys(store, page.Rows), gtKeys[wantStart:wantEnd]) {
		t.Fatalf("seed %d step %d: window engine=%v truth=%v", seed, step, rowKeys(store, page.Rows), gtKeys[wantStart:wantEnd])
	}
	if (page.PrevCursor != "") != (wantStart > 0) {
		t.Fatalf("seed %d step %d: prev existence=%v wantStart=%d", seed, step, page.PrevCursor != "", wantStart)
	}
	if (page.NextCursor != "") != (wantEnd < len(gtKeys)) {
		t.Fatalf("seed %d step %d: next existence=%v end=%d of %d", seed, step, page.NextCursor != "", wantEnd, len(gtKeys))
	}

	// Continuation: walk backward to the start and forward to the end; the
	// concatenation must equal the oracle's full ordered key list.
	full := walkBothWays(t, store, q, page, seed, step)
	if !equalStrs(full, gtKeys) {
		t.Fatalf("seed %d step %d: continuation walk=%v truth=%v", seed, step, full, gtKeys)
	}
}

// walkBothWays pages backward from `page` to the first page, then forward to the
// last, returning every key in display order (including the landing window).
func walkBothWays(t *testing.T, store *Store[podRow], q Query, page Page[podRow], seed int64, step int) []string {
	t.Helper()
	var before []string
	cursor := page.PrevCursor
	for guard := 0; cursor != ""; guard++ {
		if guard > 1000 {
			t.Fatalf("seed %d step %d: backward walk did not terminate", seed, step)
		}
		pq := q
		pq.Cursor = cursor
		p, err := store.Query(pq)
		if err != nil {
			t.Fatalf("seed %d step %d: backward query: %v", seed, step, err)
		}
		if p.CursorInvalid {
			t.Fatalf("seed %d step %d: backward walk flagged CursorInvalid", seed, step)
		}
		before = append(rowKeys(store, p.Rows), before...)
		cursor = p.PrevCursor
	}
	full := append(before, rowKeys(store, page.Rows)...)
	cursor = page.NextCursor
	for guard := 0; cursor != ""; guard++ {
		if guard > 1000 {
			t.Fatalf("seed %d step %d: forward walk did not terminate", seed, step)
		}
		pq := q
		pq.Cursor = cursor
		p, err := store.Query(pq)
		if err != nil {
			t.Fatalf("seed %d step %d: forward query: %v", seed, step, err)
		}
		full = append(full, rowKeys(store, p.Rows)...)
		cursor = p.NextCursor
	}
	return full
}

// Fuzz for the offset serve: QueryAt must slice the oracle's key list exactly,
// clamping beyond-end starts to the last aligned page.
func TestQueryAtFuzzEquivalentToRecompute(t *testing.T) {
	namespaces := []string{"default", "kube-system", "app"}
	for seed := int64(1); seed <= 15; seed++ {
		r := rand.New(rand.NewSource(seed + 500))
		schema := podSchema()
		store := NewStore(schema)
		gt := &groundTruth{schema: schema, rows: map[string]podRow{}}

		for i := 0; i < 60; i++ {
			row := podRow{
				uid:       fmt.Sprintf("u%02d", i),
				namespace: namespaces[r.Intn(len(namespaces))],
				name:      fmt.Sprintf("pod-%02d", r.Intn(50)),
				status:    "Running",
				cpu:       int64(r.Intn(10)),
			}
			store.Upsert(row)
			gt.upsert(row)
		}

		for trial := 0; trial < 30; trial++ {
			q := Query{
				ClusterID: "c", Signature: "sig", Sort: "name",
				Direction: Ascending, Limit: 1 + r.Intn(9),
			}
			if r.Intn(2) == 0 {
				q.Filters = map[string][]string{"namespace": {namespaces[r.Intn(len(namespaces))]}}
			}
			gtKeys, _, _ := gt.query(q)
			start := r.Intn(80) - 5 // includes negative and beyond-end

			page, err := store.QueryAt(q, start)
			if err != nil {
				t.Fatalf("seed %d trial %d: %v", seed, trial, err)
			}

			want := start
			if want < 0 {
				want = 0
			}
			if len(gtKeys) == 0 {
				want = 0
			} else if last := ((len(gtKeys) - 1) / q.Limit) * q.Limit; want > last {
				want = last
			}
			if page.PageStartRank != want {
				t.Fatalf("seed %d trial %d: pageStart=%d want=%d (n=%d limit=%d start=%d)",
					seed, trial, page.PageStartRank, want, len(gtKeys), q.Limit, start)
			}
			end := want + q.Limit
			if end > len(gtKeys) {
				end = len(gtKeys)
			}
			if len(gtKeys) == 0 {
				end = 0
			}
			if !equalStrs(rowKeys(store, page.Rows), gtKeys[want:end]) {
				t.Fatalf("seed %d trial %d: rows=%v want=%v", seed, trial, rowKeys(store, page.Rows), gtKeys[want:end])
			}
		}
	}
}

// A counted serve mints a SELF cursor addressing its own window, so a later
// plain Query with that token reproduces the landing page exactly — the
// page-stability primitive live refetches use after an anchor jump. Page-1
// windows mint "" (an empty token IS the first page's address).
func TestQueryAroundMintsSelfCursor(t *testing.T) {
	s := storeOfN(t, 95)
	q := nameQuery(20)

	page, _, err := s.QueryAround(q, "u0047") // rank 47 → window 40-59
	if err != nil {
		t.Fatal(err)
	}
	if page.SelfCursor == "" {
		t.Fatal("mid-list anchored window minted no self cursor")
	}
	q2 := q
	q2.Cursor = page.SelfCursor
	replay, err := s.Query(q2)
	if err != nil {
		t.Fatal(err)
	}
	if replay.CursorInvalid {
		t.Fatal("self cursor flagged invalid on replay")
	}
	if len(replay.Rows) != len(page.Rows) || replay.Rows[0].name != page.Rows[0].name ||
		replay.Rows[len(replay.Rows)-1].name != page.Rows[len(page.Rows)-1].name {
		t.Fatalf("self-cursor replay [%s..%s] != landing [%s..%s]",
			replay.Rows[0].name, replay.Rows[len(replay.Rows)-1].name,
			page.Rows[0].name, page.Rows[len(page.Rows)-1].name)
	}

	// First-page landing → empty self token.
	page, _, err = s.QueryAround(q, "u0003")
	if err != nil {
		t.Fatal(err)
	}
	if page.SelfCursor != "" {
		t.Fatalf("first-page window minted self cursor %q, want empty", page.SelfCursor)
	}

	// Offset serves mint it too.
	at, err := s.QueryAt(q, 40)
	if err != nil {
		t.Fatal(err)
	}
	if at.SelfCursor == "" {
		t.Fatal("offset window minted no self cursor")
	}
	q3 := q
	q3.Cursor = at.SelfCursor
	replay, err = s.Query(q3)
	if err != nil {
		t.Fatal(err)
	}
	if len(replay.Rows) == 0 || replay.Rows[0].name != at.Rows[0].name {
		t.Fatalf("offset self-cursor replay starts %q, want %q", replay.Rows[0].name, at.Rows[0].name)
	}
}
