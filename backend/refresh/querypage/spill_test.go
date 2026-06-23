package querypage

import (
	"bytes"
	"fmt"
	"path/filepath"
	"sort"
	"testing"
)

// spillRow is a representative summary row with the shape a production row has and
// that gob can encode: exported scalar fields, a slice, and a pointer. It exercises
// the codec's interned-string, numeric, slice-fallback, and pointer-to-scalar paths,
// so a round-trip that preserves it proves the rows survive spill/restore intact.
type spillRow struct {
	UID       string
	Namespace string
	Name      string
	Status    string
	CPU       int64
	Labels    []string // slice -> codec fallback column; gob-encodable
	Owner     *string  // pointer-to-scalar; gob-encodable
}

func spillSchema() Schema[spillRow] {
	return Schema[spillRow]{
		UID: func(r spillRow) string { return r.UID },
		SortKeys: map[string]func(spillRow) string{
			"name": func(r spillRow) string { return r.Name },
			// zero-pad so lexical order matches numeric order
			"cpu": func(r spillRow) string { return fmt.Sprintf("%012d", r.CPU) },
		},
		Facets: map[string]func(spillRow) string{
			"namespace": func(r spillRow) string { return r.Namespace },
			"status":    func(r spillRow) string { return r.Status },
		},
		SearchText: func(r spillRow) string { return r.Name },
	}
}

// buildSpillStore populates a store with ~500 varied rows that include sort-key ties
// (cpu repeats across rows), multiple namespaces and statuses, a non-nil and nil
// pointer mix, and slices — the variety the round-trip must preserve exactly.
func buildSpillStore(t *testing.T) *Store[spillRow] {
	t.Helper()
	s := NewStore(spillSchema())
	namespaces := []string{"default", "kube-system", "prod", "staging"}
	statuses := []string{"Running", "Pending", "Failed", "Succeeded"}
	const n = 500
	for i := 0; i < n; i++ {
		var owner *string
		if i%3 == 0 {
			o := fmt.Sprintf("owner-%d", i%7)
			owner = &o
		}
		s.Upsert(spillRow{
			UID:       fmt.Sprintf("u%04d", i),
			Namespace: namespaces[i%len(namespaces)],
			Name:      fmt.Sprintf("pod-%04d", (i*131)%n),
			Status:    statuses[i%len(statuses)],
			CPU:       int64(i % 50), // ties: many rows share a cpu value
			Labels:    []string{fmt.Sprintf("app=%d", i%4), fmt.Sprintf("tier=%d", i%2)},
			Owner:     owner,
		})
	}
	return s
}

// representativeQuery is a paged sort with both a facet filter and a search term, so
// asserting equality across it exercises the rebuilt indexes, facet counters, and the
// match cache together.
func representativeQuery() Query {
	return Query{
		ClusterID: "c1",
		Signature: "sig",
		Sort:      "cpu",
		Direction: Ascending,
		Limit:     25,
		Search:    "pod-0",
		Filters:   map[string][]string{"status": {"Running", "Pending"}},
	}
}

func sortedUIDs(rows []spillRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.UID
	}
	sort.Strings(out)
	return out
}

// assertStoresEquivalent proves the restored store is byte-equivalent in query
// behavior: same Len, same Snapshot set, and an identical paged Query result
// (rows in order, Total, Facets, and both cursors) — which can only hold if the
// rebuilt b-tree indexes, facet counters, and match cache match the original.
func assertStoresEquivalent(t *testing.T, orig, restored *Store[spillRow]) {
	t.Helper()
	if orig.Len() != restored.Len() {
		t.Fatalf("Len mismatch: orig=%d restored=%d", orig.Len(), restored.Len())
	}

	wantSnap := sortedUIDs(orig.Snapshot())
	gotSnap := sortedUIDs(restored.Snapshot())
	if len(wantSnap) != len(gotSnap) {
		t.Fatalf("snapshot len mismatch: orig=%d restored=%d", len(wantSnap), len(gotSnap))
	}
	for i := range wantSnap {
		if wantSnap[i] != gotSnap[i] {
			t.Fatalf("snapshot uid mismatch at %d: orig=%q restored=%q", i, wantSnap[i], gotSnap[i])
		}
	}

	q := representativeQuery()
	wantPage, err := orig.Query(q)
	if err != nil {
		t.Fatalf("orig.Query: %v", err)
	}
	gotPage, err := restored.Query(q)
	if err != nil {
		t.Fatalf("restored.Query: %v", err)
	}
	if wantPage.Total != gotPage.Total {
		t.Fatalf("Total mismatch: orig=%d restored=%d", wantPage.Total, gotPage.Total)
	}
	if wantPage.NextCursor != gotPage.NextCursor {
		t.Fatalf("NextCursor mismatch:\norig=%q\nrestored=%q", wantPage.NextCursor, gotPage.NextCursor)
	}
	if wantPage.PrevCursor != gotPage.PrevCursor {
		t.Fatalf("PrevCursor mismatch:\norig=%q\nrestored=%q", wantPage.PrevCursor, gotPage.PrevCursor)
	}
	if len(wantPage.Rows) != len(gotPage.Rows) {
		t.Fatalf("page row count mismatch: orig=%d restored=%d", len(wantPage.Rows), len(gotPage.Rows))
	}
	for i := range wantPage.Rows {
		w, g := wantPage.Rows[i], gotPage.Rows[i]
		if w.UID != g.UID {
			t.Fatalf("page row %d uid mismatch: orig=%q restored=%q", i, w.UID, g.UID)
		}
		if !rowsDeepEqual(w, g) {
			t.Fatalf("page row %d content mismatch: orig=%+v restored=%+v", i, w, g)
		}
	}
	if len(wantPage.Facets) != len(gotPage.Facets) {
		t.Fatalf("facet group count mismatch: orig=%d restored=%d", len(wantPage.Facets), len(gotPage.Facets))
	}
	for name, wantCounts := range wantPage.Facets {
		gotCounts := gotPage.Facets[name]
		if len(wantCounts) != len(gotCounts) {
			t.Fatalf("facet %q value count mismatch: orig=%d restored=%d", name, len(wantCounts), len(gotCounts))
		}
		for v, c := range wantCounts {
			if gotCounts[v] != c {
				t.Fatalf("facet %q[%q] mismatch: orig=%d restored=%d", name, v, c, gotCounts[v])
			}
		}
	}
}

// rowsDeepEqual compares two spillRows including the slice and pointer fields.
func rowsDeepEqual(a, b spillRow) bool {
	if a.UID != b.UID || a.Namespace != b.Namespace || a.Name != b.Name ||
		a.Status != b.Status || a.CPU != b.CPU {
		return false
	}
	if (a.Owner == nil) != (b.Owner == nil) {
		return false
	}
	if a.Owner != nil && *a.Owner != *b.Owner {
		return false
	}
	if len(a.Labels) != len(b.Labels) {
		return false
	}
	for i := range a.Labels {
		if a.Labels[i] != b.Labels[i] {
			return false
		}
	}
	return true
}

func TestSpillRestoreRoundTrip(t *testing.T) {
	orig := buildSpillStore(t)

	var buf bytes.Buffer
	if err := orig.Spill(&buf); err != nil {
		t.Fatalf("Spill: %v", err)
	}

	restored, err := RestoreStore(&buf, spillSchema())
	if err != nil {
		t.Fatalf("RestoreStore: %v", err)
	}

	assertStoresEquivalent(t, orig, restored)
}

func TestSpillToFileRoundTrip(t *testing.T) {
	orig := buildSpillStore(t)

	path := filepath.Join(t.TempDir(), "store.spill")
	if err := orig.SpillToFile(path); err != nil {
		t.Fatalf("SpillToFile: %v", err)
	}

	restored, err := RestoreStoreFromFile(path, spillSchema())
	if err != nil {
		t.Fatalf("RestoreStoreFromFile: %v", err)
	}

	assertStoresEquivalent(t, orig, restored)
}
