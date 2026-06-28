package querypage

import (
	"bytes"
	"fmt"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"
	"unsafe"

	"github.com/stretchr/testify/require"
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

// TestSpillColumnsRoundTrip is the Tier 2.6 gate: spilling the store in the columnar mmap
// on-disk format and restoring it produces a query-equivalent store — proving the column
// format is a faithful drop-in for the gob baseline. spillRow exercises string, int, a
// slice-fallback (Labels), and a pointer-to-scalar (Owner) field, so all the codec paths the
// columnar serializer must handle are covered.
func TestSpillColumnsRoundTrip(t *testing.T) {
	orig := buildSpillStore(t)

	path := filepath.Join(t.TempDir(), "store.cols")
	if err := orig.SpillColumns(path); err != nil {
		t.Fatalf("SpillColumns: %v", err)
	}

	restored, err := RestoreColumnsFromFile(path, spillSchema())
	if err != nil {
		t.Fatalf("RestoreColumnsFromFile: %v", err)
	}

	assertStoresEquivalent(t, orig, restored)
}

// TestSpillInternedColumnsRoundTripsNilPointerStructFallback proves a nil pointer-to-struct
// field (the production *resourcemodel.ResourceLink) survives spill+reopen as nil instead of
// crashing the spill. Such a field goes through the codec's gob "fallback" column, and gob
// cannot encode a top-level nil pointer — which panicked the whole app when cooling a cluster
// whose rows carried a nil link.
func TestSpillInternedColumnsRoundTripsNilPointerStructFallback(t *testing.T) {
	type link struct{ Group, Kind, Name string }
	type row struct {
		UID  string
		Link *link // pointer-to-struct -> gob fallback column; nil must round-trip
	}
	schema := Schema[row]{
		UID:      func(r row) string { return r.UID },
		SortKeys: map[string]func(row) string{"uid": func(r row) string { return r.UID }},
	}
	s := NewStore(schema)
	s.Upsert(row{UID: "a", Link: &link{Group: "apps", Kind: "Deployment", Name: "web"}})
	s.Upsert(row{UID: "b", Link: nil}) // the crashing case

	path := filepath.Join(t.TempDir(), "cols.qcm")
	if err := s.SpillInternedColumns(path); err != nil {
		t.Fatalf("SpillInternedColumns: %v", err)
	}
	restored, closer, err := OpenInternedColumnStore(path, schema)
	if err != nil {
		t.Fatalf("OpenInternedColumnStore: %v", err)
	}
	defer closer()

	byUID := make(map[string]*link)
	for _, r := range restored.Snapshot() {
		byUID[r.UID] = r.Link
	}
	if byUID["a"] == nil || byUID["a"].Name != "web" {
		t.Fatalf("non-nil link not preserved: %+v", byUID["a"])
	}
	if byUID["b"] != nil {
		t.Fatalf("nil link must round-trip as nil, got %+v", byUID["b"])
	}
}

// TestInternedColumnStoreMmapRoundTrip is the Tier 2.6 dual-mode SERVING gate: spilling the
// interned columns and reopening as a read-only, mmap-aliased store produces a query-equivalent
// store — proving a Cold cluster can serve directly from off-heap page cache. spillRow exercises
// string (interned), int, slice-fallback (Labels), and pointer-to-scalar (Owner).
func TestInternedColumnStoreMmapRoundTrip(t *testing.T) {
	orig := buildSpillStore(t)

	path := filepath.Join(t.TempDir(), "store.qcm")
	if err := orig.SpillInternedColumns(path); err != nil {
		t.Fatalf("SpillInternedColumns: %v", err)
	}

	restored, closer, err := OpenInternedColumnStore(path, spillSchema())
	if err != nil {
		t.Fatalf("OpenInternedColumnStore: %v", err)
	}
	defer closer()

	assertStoresEquivalent(t, orig, restored)

	// The store is read-only: a write is ignored (mutating mmap-aliased columns is invalid).
	before := restored.Len()
	restored.Upsert(spillRow{UID: "new", Namespace: "x", Name: "y"})
	require.Equal(t, before, restored.Len(), "read-only mmap store ignores Upsert")
}

// TestReopenInternedColumnsInPlace proves the Cold-serving transition at the store level: the
// same *Store pointer, after ReopenInternedColumnsInPlace, serves queries identically (now from
// the mmap-aliased columns) and rejects writes.
func TestReopenInternedColumnsInPlace(t *testing.T) {
	orig := buildSpillStore(t)
	// A reference store to compare against (orig is mutated in place).
	ref := buildSpillStore(t)

	path := filepath.Join(t.TempDir(), "inplace.qcm")
	closer, err := orig.ReopenInternedColumnsInPlace(path)
	if err != nil {
		t.Fatalf("ReopenInternedColumnsInPlace: %v", err)
	}
	defer closer()

	assertStoresEquivalent(t, ref, orig)

	before := orig.Len()
	orig.Upsert(spillRow{UID: "new", Namespace: "x", Name: "y"})
	require.Equal(t, before, orig.Len(), "in-place mmap store ignores Upsert")
}

func TestMmapQueryRowsDoNotAliasMappingAfterQueryReturns(t *testing.T) {
	s := buildSpillStore(t)
	path := filepath.Join(t.TempDir(), "rows-detached.qcm")
	closer, err := s.ReopenInternedColumnsInPlace(path)
	require.NoError(t, err)

	page, err := s.Query(Query{
		ClusterID: "c1",
		Signature: "sig",
		Sort:      "name",
		Direction: Ascending,
		Limit:     50,
	})
	require.NoError(t, err)
	require.NotEmpty(t, page.Rows)

	var row spillRow
	for _, candidate := range page.Rows {
		if candidate.Owner != nil {
			row = candidate
			break
		}
	}
	require.NotEmpty(t, row.UID, "fixture query should return a row with a pointer string")

	rowID, ok := s.rows.rowByUID[row.UID]
	require.True(t, ok)

	requireDetachedString(t, row.Name, mmapStringFieldValue(t, s, "Name", rowID), "Name")
	requireDetachedString(t, row.Status, mmapStringFieldValue(t, s, "Status", rowID), "Status")
	requireDetachedString(t, *row.Owner, mmapStringFieldValue(t, s, "Owner", rowID), "Owner")

	want := row
	require.NoError(t, closer())
	require.Equal(t, want.Name, row.Name)
	require.Equal(t, want.Status, row.Status)
	require.Equal(t, *want.Owner, *row.Owner)
}

func mmapStringFieldValue(t *testing.T, s *Store[spillRow], fieldName string, rowID uint32) string {
	t.Helper()
	fc := codecFieldByName(t, s.rows.codec, fieldName)
	switch fc.kind {
	case fieldString:
		if fc.promoted {
			return fc.plainStr[rowID]
		}
		return s.rows.dicts.dict(fc).value(fc.strCol[rowID])
	case fieldPtrScalar:
		require.True(t, fc.present[rowID], "field %s should be present", fieldName)
		require.Equal(t, fieldString, fc.elemKind, "field %s should be a pointer-to-string", fieldName)
		return s.rows.dicts.dict(fc).value(fc.strCol[rowID])
	default:
		t.Fatalf("field %s is not string-backed: %v", fieldName, fc.kind)
		return ""
	}
}

func codecFieldByName[R any](t *testing.T, codec *rowCodec[R], fieldName string) *fieldCodec {
	t.Helper()
	for _, fc := range codec.fields {
		field := codec.typ.FieldByIndex(fc.index)
		if field.Name == fieldName {
			return fc
		}
	}
	t.Fatalf("field %s not found in codec for %s", fieldName, codec.typ)
	return nil
}

func requireDetachedString(t *testing.T, got, source, label string) {
	t.Helper()
	if got == "" || source == "" {
		return
	}
	if stringData(got) == stringData(source) {
		t.Fatalf("%s string aliases mmap-backed column data", label)
	}
}

func stringData(value string) uintptr {
	return uintptr(unsafe.Pointer(unsafe.StringData(value)))
}

// TestReopenInternedColumnsInPlaceCloserWaitsForInFlightQuery proves the mmap closer is
// safe-by-construction: a Query in flight (holding the store's read lock while it
// reconstructs rows from mmap-backed columns) blocks the unmap until it returns. The closer
// must acquire the store's write lock before unmapping, so it serializes after every in-flight
// Query.
func TestReopenInternedColumnsInPlaceCloserWaitsForInFlightQuery(t *testing.T) {
	s := buildSpillStore(t)
	path := filepath.Join(t.TempDir(), "inflight.qcm")
	closer, err := s.ReopenInternedColumnsInPlace(path)
	require.NoError(t, err)

	// Hold the store's read lock to simulate a Query in flight reconstructing rows from
	// mmap-backed columns. The closer must not unmap while this is held.
	s.mu.RLock()

	closed := make(chan struct{})
	go func() {
		_ = closer()
		close(closed)
	}()

	select {
	case <-closed:
		s.mu.RUnlock()
		t.Fatal("closer unmapped while a reader held the store lock (use-after-free risk)")
	case <-time.After(50 * time.Millisecond):
		// Expected: the closer is blocked waiting for the read lock to release.
	}

	s.mu.RUnlock()
	select {
	case <-closed:
		// Expected: once the reader released, the closer acquired the lock and unmapped.
	case <-time.After(time.Second):
		t.Fatal("closer did not complete after the reader released the lock")
	}
}

// TestReopenInternedColumnsInPlaceConcurrentQueryAndClose runs many Queries concurrently
// with the close, mirroring the production re-warm ordering: a reader pool runs against the
// cooled store, the store is then UNROUTED (no new Query may start — the test stops issuing
// new Queries and waits for in-flight ones to return), and only then is the closer called.
// The lock-safe closer serializes after any straggler in-flight Query, so the race detector
// proves no Query reads the mapping after the unmap.
func TestReopenInternedColumnsInPlaceConcurrentQueryAndClose(t *testing.T) {
	s := buildSpillStore(t)
	path := filepath.Join(t.TempDir(), "concurrent.qcm")
	closer, err := s.ReopenInternedColumnsInPlace(path)
	require.NoError(t, err)

	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_, _ = s.Query(representativeQuery())
				}
			}
		}()
	}

	// Let the readers run, then UNROUTE: stop issuing new Queries and drain the in-flight
	// ones. In production the subsystem is removed from the serving map before close, so no
	// new Query can resolve the cooled store; the test reproduces that by stopping + joining
	// the readers first. The lock-safe closer then serializes after the last in-flight read.
	time.Sleep(10 * time.Millisecond)
	close(stop)
	wg.Wait()
	require.NoError(t, closer())
}

// TestReopenInternedColumnsInPlaceCloserIdempotent proves the closer is safe to call more
// than once: a re-warm/teardown race must never double-unmap.
func TestReopenInternedColumnsInPlaceCloserIdempotent(t *testing.T) {
	s := buildSpillStore(t)
	path := filepath.Join(t.TempDir(), "idempotent.qcm")
	closer, err := s.ReopenInternedColumnsInPlace(path)
	require.NoError(t, err)
	require.NoError(t, closer())
	require.NoError(t, closer(), "second close must be a no-op, not a double-unmap")
}

// TestSpillColumnsAllScalarKinds covers the numeric/bool/float field kinds that spillRow does
// not, so the columnar serializer is gated on every scalar kind.
func TestSpillColumnsAllScalarKinds(t *testing.T) {
	type allKinds struct {
		UID  string
		I    int64
		U    uint32
		F    float64
		B    bool
		Note *string
	}
	schema := Schema[allKinds]{
		UID:        func(r allKinds) string { return r.UID },
		SortKeys:   map[string]func(allKinds) string{"i": func(r allKinds) string { return fmt.Sprintf("%020d", r.I) }},
		Facets:     map[string]func(allKinds) string{"b": func(r allKinds) string { return fmt.Sprintf("%v", r.B) }},
		SearchText: func(r allKinds) string { return r.UID },
	}
	s := NewStore(schema)
	note := "n"
	s.Upsert(allKinds{UID: "a", I: -5, U: 4_000_000_000, F: 3.5, B: true, Note: &note})
	s.Upsert(allKinds{UID: "b", I: 1 << 40, U: 0, F: -2.25, B: false, Note: nil})

	path := filepath.Join(t.TempDir(), "allkinds.cols")
	require.NoError(t, s.SpillColumns(path))
	restored, err := RestoreColumnsFromFile(path, schema)
	require.NoError(t, err)

	require.Len(t, restored.Snapshot(), 2)
	got := map[string]allKinds{}
	for _, r := range restored.Snapshot() {
		got[r.UID] = r
	}
	require.Equal(t, int64(-5), got["a"].I)
	require.Equal(t, uint32(4_000_000_000), got["a"].U)
	require.Equal(t, 3.5, got["a"].F)
	require.True(t, got["a"].B)
	require.NotNil(t, got["a"].Note)
	require.Equal(t, "n", *got["a"].Note)
	require.Nil(t, got["b"].Note, "nil pointer-to-scalar round-trips as nil")
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

// TestRestoreFromIntoExistingStore proves RestoreFrom loads the spilled rows INTO an
// already-constructed store (preserving its schema + any wiring that references it),
// which is what a maintained store's warm-restore on re-warm needs — unlike RestoreStore,
// which builds a fresh one. The target store keeps its own schema; after RestoreFrom it is
// query-equivalent to the original.
func TestRestoreFromIntoExistingStore(t *testing.T) {
	orig := buildSpillStore(t)

	var buf bytes.Buffer
	if err := orig.Spill(&buf); err != nil {
		t.Fatalf("Spill: %v", err)
	}

	target := NewStore(spillSchema())
	if err := target.RestoreFrom(&buf); err != nil {
		t.Fatalf("RestoreFrom: %v", err)
	}

	assertStoresEquivalent(t, orig, target)
}

// TestRestoreFromFileOverwritesByKey proves RestoreFrom upserts by UID into a non-empty
// store: a pre-existing row with a UID also present in the spill is replaced by the
// spilled version, and rows whose UID is absent from the spill are left untouched. (The
// re-warm path restores into a fresh store, but this pins the merge semantics.)
func TestRestoreFromFileOverwritesByKey(t *testing.T) {
	orig := buildSpillStore(t)
	path := filepath.Join(t.TempDir(), "store.spill")
	if err := orig.SpillToFile(path); err != nil {
		t.Fatalf("SpillToFile: %v", err)
	}

	target := NewStore(spillSchema())
	// A row whose UID collides with a spilled row (u0000) but with stale content, and a
	// row whose UID is unique to the target (keep-me).
	target.Upsert(spillRow{UID: "u0000", Namespace: "stale", Name: "stale", Status: "Stale", CPU: 999})
	target.Upsert(spillRow{UID: "keep-me", Namespace: "x", Name: "keep", Status: "Running", CPU: 1})

	if err := target.RestoreFromFile(path); err != nil {
		t.Fatalf("RestoreFromFile: %v", err)
	}

	byUID := make(map[string]spillRow)
	for _, r := range target.Snapshot() {
		byUID[r.UID] = r
	}
	// The colliding UID now holds the spilled content, not the stale one.
	if got, ok := byUID["u0000"]; !ok || got.Namespace == "stale" {
		t.Fatalf("u0000 should be overwritten by the spilled row, got ok=%v row=%+v", ok, got)
	}
	// The target-only row survives (restore upserts, it does not clear).
	if _, ok := byUID["keep-me"]; !ok {
		t.Fatalf("keep-me should survive RestoreFrom (upsert, not replace)")
	}
}
