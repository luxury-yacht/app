package querypage

import (
	"fmt"
	"sort"
	"testing"
)

type podRow struct {
	uid       string
	namespace string
	name      string
	status    string
	cpu       int64
}

func podSchema() Schema[podRow] {
	return Schema[podRow]{
		UID: func(p podRow) string { return p.uid },
		SortKeys: map[string]func(podRow) string{
			"name": func(p podRow) string { return p.name },
			// zero-pad so lexical order matches numeric order
			"cpu": func(p podRow) string { return fmt.Sprintf("%012d", p.cpu) },
		},
		Facets: map[string]func(podRow) string{
			"namespace": func(p podRow) string { return p.namespace },
			"status":    func(p podRow) string { return p.status },
		},
		SearchText: func(p podRow) string { return p.name },
	}
}

func TestReplaceWhereReplacesOnlyOwnedRows(t *testing.T) {
	s := NewStore(podSchema())
	s.Upsert(podRow{uid: "deploy-old", namespace: "default", name: "deploy-old", status: "Deployment", cpu: 1})
	s.Upsert(podRow{uid: "service-keep", namespace: "default", name: "service-keep", status: "Service", cpu: 2})

	s.ReplaceWhere([]podRow{
		{uid: "deploy-new", namespace: "default", name: "deploy-new", status: "Deployment", cpu: 3},
	}, func(row podRow) bool {
		return row.status == "Deployment"
	})

	rows := s.Snapshot()
	sort.Slice(rows, func(i, j int) bool { return rows[i].uid < rows[j].uid })
	got := make([]string, 0, len(rows))
	for _, row := range rows {
		got = append(got, row.uid)
	}
	want := []string{"deploy-new", "service-keep"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("rows after ReplaceWhere = %v, want %v", got, want)
	}

	_, total := s.Scope(map[string][]string{"status": {"Deployment"}}, "")
	if total != 1 {
		t.Fatalf("deployment facet total after ReplaceWhere = %d, want 1", total)
	}
}

// paginate drives a query through every page via the returned cursors and returns
// the rows in encounter order. It guards against an infinite loop.
func paginate(t *testing.T, s *Store[podRow], q Query) []podRow {
	t.Helper()
	var all []podRow
	for guard := 0; ; guard++ {
		if guard > 10000 {
			t.Fatal("pagination did not terminate")
		}
		page, err := s.Query(q)
		if err != nil {
			t.Fatalf("query: %v", err)
		}
		all = append(all, page.Rows...)
		if page.NextCursor == "" {
			return all
		}
		q.Cursor = page.NextCursor
	}
}

func TestPaginateAscendingComplete(t *testing.T) {
	s := NewStore(podSchema())
	const n = 95
	for i := 0; i < n; i++ {
		s.Upsert(podRow{uid: fmt.Sprintf("u%03d", i), namespace: "default", name: fmt.Sprintf("pod-%03d", i), status: "Running", cpu: int64(i)})
	}
	all := paginate(t, s, Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 20})
	if len(all) != n {
		t.Fatalf("got %d rows across pages, want %d", len(all), n)
	}
	for i := 1; i < len(all); i++ {
		if all[i].name <= all[i-1].name {
			t.Fatalf("not strictly ascending at %d: %q <= %q", i, all[i].name, all[i-1].name)
		}
	}
}

func TestPaginateDescendingByCPU(t *testing.T) {
	s := NewStore(podSchema())
	const n = 50
	for i := 0; i < n; i++ {
		s.Upsert(podRow{uid: fmt.Sprintf("u%03d", i), namespace: "default", name: fmt.Sprintf("pod-%03d", i), status: "Running", cpu: int64(i * 7 % n)})
	}
	all := paginate(t, s, Query{ClusterID: "c", Signature: "sig", Sort: "cpu", Direction: Descending, Limit: 7})
	if len(all) != n {
		t.Fatalf("got %d rows, want %d", len(all), n)
	}
	for i := 1; i < len(all); i++ {
		if all[i].cpu > all[i-1].cpu {
			t.Fatalf("not descending at %d: %d > %d", i, all[i].cpu, all[i-1].cpu)
		}
	}
}

func TestExactlyFullPageHasNoSpuriousNext(t *testing.T) {
	s := NewStore(podSchema())
	for i := 0; i < 20; i++ {
		s.Upsert(podRow{uid: fmt.Sprintf("u%02d", i), namespace: "default", name: fmt.Sprintf("pod-%02d", i), status: "Running", cpu: int64(i)})
	}
	// Exactly limit rows exist: the first page must report no next cursor.
	page, err := s.Query(Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 20 {
		t.Fatalf("got %d rows, want 20", len(page.Rows))
	}
	if page.NextCursor != "" {
		t.Fatalf("a full final page should have no next cursor, got %q", page.NextCursor)
	}
}

// TestCursorStableAcrossDeletes deletes a not-yet-seen row between pages and a
// not-yet-seen row's deletion must not cause a skip or duplicate.
func TestCursorStableAcrossDeletes(t *testing.T) {
	s := NewStore(podSchema())
	const n = 60
	for i := 0; i < n; i++ {
		s.Upsert(podRow{uid: fmt.Sprintf("u%03d", i), namespace: "default", name: fmt.Sprintf("pod-%03d", i), status: "Running", cpu: int64(i)})
	}
	q := Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 10}

	page1, err := s.Query(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(page1.Rows) != 10 {
		t.Fatalf("page1 had %d rows", len(page1.Rows))
	}
	// Delete a row that has NOT been returned yet (pod-050, beyond page 1's pod-000..009).
	s.Delete("u050")
	// Also delete the last row that WAS returned (the cursor anchor) to test a deleted anchor.
	s.Delete(page1.Rows[len(page1.Rows)-1].uid)

	q.Cursor = page1.NextCursor
	rest := paginate(t, s, q)

	seen := map[string]bool{}
	for _, r := range page1.Rows {
		seen[r.uid] = true
	}
	for _, r := range rest {
		if seen[r.uid] {
			t.Fatalf("duplicate row across pages: %s", r.uid)
		}
		seen[r.uid] = true
	}
	// We deleted 2 rows; the deleted anchor was on page1 (counted), the unseen one
	// (u050) must be absent. Expect n-1 distinct (u050 gone; the anchor stays counted
	// in page1 since it was returned before deletion).
	if seen["u050"] {
		t.Fatal("deleted unseen row u050 leaked into results")
	}
	// Order across the boundary must still hold.
	all := append(append([]podRow{}, page1.Rows...), rest...)
	for i := 1; i < len(all); i++ {
		if all[i].name <= all[i-1].name {
			t.Fatalf("order broke across delete at %d: %q <= %q", i, all[i].name, all[i-1].name)
		}
	}
}

func TestFilterByFacet(t *testing.T) {
	s := NewStore(podSchema())
	for i := 0; i < 40; i++ {
		ns := "default"
		if i%4 == 0 {
			ns = "kube-system"
		}
		s.Upsert(podRow{uid: fmt.Sprintf("u%02d", i), namespace: ns, name: fmt.Sprintf("pod-%02d", i), status: "Running", cpu: int64(i)})
	}
	all := paginate(t, s, Query{
		ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 5,
		Filters: map[string][]string{"namespace": {"kube-system"}},
	})
	if len(all) != 10 {
		t.Fatalf("filtered got %d rows, want 10", len(all))
	}
	for _, r := range all {
		if r.namespace != "kube-system" {
			t.Fatalf("filter leaked row in namespace %q", r.namespace)
		}
	}
}

func TestSearchSubstring(t *testing.T) {
	s := NewStore(podSchema())
	names := []string{"frontend-a", "frontend-b", "backend-a", "cache-x", "frontend-c"}
	for i, nm := range names {
		s.Upsert(podRow{uid: fmt.Sprintf("u%d", i), namespace: "default", name: nm, status: "Running", cpu: int64(i)})
	}
	all := paginate(t, s, Query{
		ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 10,
		Search: "FRONT", // case-insensitive
	})
	if len(all) != 3 {
		t.Fatalf("search got %d rows, want 3", len(all))
	}
	for _, r := range all {
		if r.name[:8] != "frontend" {
			t.Fatalf("search leaked %q", r.name)
		}
	}
}

func TestFacetsAndTotal(t *testing.T) {
	s := NewStore(podSchema())
	for i := 0; i < 30; i++ {
		st := "Running"
		if i%3 == 0 {
			st = "Pending"
		}
		s.Upsert(podRow{uid: fmt.Sprintf("u%02d", i), namespace: "default", name: fmt.Sprintf("pod-%02d", i), status: st, cpu: int64(i)})
	}
	page, err := s.Query(Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 30 {
		t.Fatalf("total = %d, want 30 (unfiltered)", page.Total)
	}
	if got := page.Facets["status"]["Pending"]; got != 10 {
		t.Fatalf("facet status=Pending = %d, want 10", got)
	}
	if got := page.Facets["status"]["Running"]; got != 20 {
		t.Fatalf("facet status=Running = %d, want 20", got)
	}
	// Filtered total reflects the filter.
	fpage, err := s.Query(Query{ClusterID: "c", Signature: "sig2", Sort: "name", Direction: Ascending, Limit: 5, Filters: map[string][]string{"status": {"Pending"}}})
	if err != nil {
		t.Fatal(err)
	}
	if fpage.Total != 10 {
		t.Fatalf("filtered total = %d, want 10", fpage.Total)
	}
}

func TestScopeCountsMatchQueryTotal(t *testing.T) {
	s := NewStore(podSchema())
	for i := 0; i < 30; i++ {
		st := "Running"
		ns := "default"
		if i%3 == 0 {
			st = "Pending"
		}
		if i%5 == 0 {
			ns = "kube-system"
		}
		s.Upsert(podRow{uid: fmt.Sprintf("u%02d", i), namespace: ns, name: fmt.Sprintf("pod-%02d", i), status: st, cpu: int64(i)})
	}

	// No base filters / no search: Scope total equals the whole store, and the per-facet
	// counts equal the maintained facet counters.
	facets, total := s.Scope(nil, "")
	if total != 30 {
		t.Fatalf("scope total = %d, want 30", total)
	}
	if facets["status"]["Pending"] != 10 || facets["status"]["Running"] != 20 {
		t.Fatalf("scope status facets = %v, want Pending=10 Running=20", facets["status"])
	}

	// A base filter restricts the scope total and every facet count to the matching set,
	// matching Query's filtered Total exactly.
	base := map[string][]string{"status": {"Pending"}}
	fpage, err := s.Query(Query{ClusterID: "c", Signature: "s", Sort: "name", Direction: Ascending, Limit: 5, Filters: base})
	if err != nil {
		t.Fatal(err)
	}
	sFacets, sTotal := s.Scope(base, "")
	if sTotal != fpage.Total {
		t.Fatalf("scope total %d != query total %d", sTotal, fpage.Total)
	}
	if sFacets["status"]["Pending"] != fpage.Total {
		t.Fatalf("scope status=Pending = %d, want %d", sFacets["status"]["Pending"], fpage.Total)
	}
	if _, present := sFacets["status"]["Running"]; present {
		t.Fatalf("scope should not count filtered-out values, got %v", sFacets["status"])
	}

	// Search narrows the scope the same way Query's filtered Total does.
	searchPage, err := s.Query(Query{ClusterID: "c", Signature: "s2", Sort: "name", Direction: Ascending, Limit: 5, Search: "pod-0"})
	if err != nil {
		t.Fatal(err)
	}
	_, searchTotal := s.Scope(nil, "pod-0")
	if searchTotal != searchPage.Total {
		t.Fatalf("scope search total %d != query total %d", searchTotal, searchPage.Total)
	}
}

func TestFacetsDecrementOnDelete(t *testing.T) {
	s := NewStore(podSchema())
	for i := 0; i < 6; i++ {
		s.Upsert(podRow{uid: fmt.Sprintf("u%d", i), namespace: "default", name: fmt.Sprintf("p%d", i), status: "Running", cpu: int64(i)})
	}
	s.Delete("u0")
	s.Delete("u1")
	page, _ := s.Query(Query{ClusterID: "c", Signature: "s", Sort: "name", Direction: Ascending, Limit: 10})
	if got := page.Facets["status"]["Running"]; got != 4 {
		t.Fatalf("facet after deletes = %d, want 4", got)
	}
	// A facet value that drops to zero must disappear, not linger at 0.
	s2 := NewStore(podSchema())
	s2.Upsert(podRow{uid: "x", namespace: "default", name: "x", status: "Failed", cpu: 1})
	s2.Delete("x")
	p2, _ := s2.Query(Query{ClusterID: "c", Signature: "s", Sort: "name", Direction: Ascending, Limit: 10})
	if _, present := p2.Facets["status"]["Failed"]; present {
		t.Fatal("zero-count facet value should be removed, not kept at 0")
	}
}

func TestCursorMismatchRestarts(t *testing.T) {
	s := NewStore(podSchema())
	for i := 0; i < 30; i++ {
		s.Upsert(podRow{uid: fmt.Sprintf("u%02d", i), namespace: "default", name: fmt.Sprintf("pod-%02d", i), status: "Running", cpu: int64(i)})
	}
	page1, _ := s.Query(Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 10})
	if page1.NextCursor == "" {
		t.Fatal("expected a next cursor")
	}
	// Reuse the cursor against a DIFFERENT sort -> must restart from the first page.
	page2, err := s.Query(Query{ClusterID: "c", Signature: "sig", Sort: "cpu", Direction: Ascending, Limit: 10, Cursor: page1.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if len(page2.Rows) != 10 {
		t.Fatalf("restarted page had %d rows", len(page2.Rows))
	}
	// First row by cpu ascending is cpu=0 (uid u00).
	if page2.Rows[0].uid != "u00" {
		t.Fatalf("mismatch did not restart: first row is %s, want u00", page2.Rows[0].uid)
	}
}

func TestUnknownSortErrors(t *testing.T) {
	s := NewStore(podSchema())
	s.Upsert(podRow{uid: "u", namespace: "default", name: "p", status: "Running", cpu: 1})
	if _, err := s.Query(Query{ClusterID: "c", Signature: "s", Sort: "memory", Direction: Ascending, Limit: 10}); err == nil {
		t.Fatal("expected an error for an unknown sort field")
	}
}

// TestPaginationMatchesGroundTruth cross-checks the full paginated traversal against
// a fresh sort of all rows — the apply(deltas)==recompute property for the engine.
func TestPaginationMatchesGroundTruth(t *testing.T) {
	s := NewStore(podSchema())
	const n = 137
	rows := make([]podRow, n)
	for i := 0; i < n; i++ {
		rows[i] = podRow{uid: fmt.Sprintf("u%03d", i), namespace: "default", name: fmt.Sprintf("pod-%05d", (i*131)%n), status: "Running", cpu: int64(i)}
		s.Upsert(rows[i])
	}
	got := paginate(t, s, Query{ClusterID: "c", Signature: "sig", Sort: "name", Direction: Ascending, Limit: 13})
	want := append([]podRow{}, rows...)
	sort.Slice(want, func(i, j int) bool {
		if want[i].name != want[j].name {
			return want[i].name < want[j].name
		}
		return want[i].uid < want[j].uid
	})
	if len(got) != len(want) {
		t.Fatalf("got %d rows, want %d", len(got), len(want))
	}
	for i := range got {
		if got[i].uid != want[i].uid {
			t.Fatalf("row %d: paginated %s, ground-truth %s", i, got[i].uid, want[i].uid)
		}
	}
}
