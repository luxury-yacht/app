package querypage

import (
	"fmt"
	"math/rand"
	"reflect"
	"runtime"
	"testing"
)

// --- Representative struct shapes for round-trip fidelity ---

// rtClusterMeta mirrors the embedded ClusterMeta struct used by every row type.
type rtClusterMeta struct {
	ClusterID   string
	ClusterName string
}

// rtTaint is a slice-element struct (the codec must fall back for the slice but
// still reconstruct each element exactly).
type rtTaint struct {
	Key    string
	Value  string
	Effect string
}

// rtScale mirrors a pointer-to-struct field (e.g. Summary.ActionFacts), which the
// codec must round-trip through its fallback column.
type rtScale struct {
	Group string
	Name  string
	Repl  int32
}

// rtWide exercises every category the codec handles: embedded struct, plain
// scalars, pointer-to-scalar, pointer-to-struct, a map, and a slice of structs.
type rtWide struct {
	rtClusterMeta
	Kind      string
	Name      string
	Count     int
	Restarts  int32
	Age       int64
	Ratio     float64
	Schedule  bool
	Replicas  *int32
	Toggle    *bool
	Scale     *rtScale
	Labels    map[string]string
	Taints    []rtTaint
	Unsigned  uint32
	BigUnders uint64
}

// rtPlain is a simple unexported-free struct (only exported scalar fields).
type rtPlain struct {
	A string
	B int64
	C bool
}

func i32(v int32) *int32 { return &v }
func bp(v bool) *bool    { return &v }
func randStr(r *rand.Rand) string {
	pool := []string{"", "default", "kube-system", "a", "longish-value-here", "x"}
	return pool[r.Intn(len(pool))]
}

func randWide(r *rand.Rand) rtWide {
	w := rtWide{
		rtClusterMeta: rtClusterMeta{ClusterID: randStr(r), ClusterName: randStr(r)},
		Kind:          randStr(r),
		Name:          randStr(r),
		Count:         r.Intn(1000) - 500,
		Restarts:      int32(r.Intn(50)),
		Age:           int64(r.Intn(1 << 30)),
		Ratio:         r.Float64(),
		Schedule:      r.Intn(2) == 0,
		Unsigned:      uint32(r.Intn(1 << 20)),
		BigUnders:     uint64(r.Int63()),
	}
	if r.Intn(2) == 0 {
		w.Replicas = i32(int32(r.Intn(10)))
	}
	if r.Intn(2) == 0 {
		w.Toggle = bp(r.Intn(2) == 0)
	}
	if r.Intn(2) == 0 {
		w.Scale = &rtScale{Group: randStr(r), Name: randStr(r), Repl: int32(r.Intn(8))}
	}
	switch r.Intn(3) {
	case 1:
		w.Labels = map[string]string{}
	case 2:
		w.Labels = map[string]string{"app": randStr(r), "team": randStr(r)}
	}
	switch r.Intn(3) {
	case 1:
		w.Taints = []rtTaint{}
	case 2:
		w.Taints = []rtTaint{{Key: randStr(r), Effect: "NoSchedule"}, {Key: randStr(r), Value: randStr(r), Effect: "NoExecute"}}
	}
	return w
}

// roundTrip encodes then decodes a value through a freshly-built codec and asserts
// deep equality — the codec's absolute contract.
func roundTrip[R any](t *testing.T, v R) {
	t.Helper()
	codec := newRowCodec[R]()
	store := newColumnStore[R](codec)
	store.put("uid", v)
	got, ok := store.get("uid")
	if !ok {
		t.Fatalf("get after put returned !ok for %#v", v)
	}
	if !reflect.DeepEqual(got, v) {
		t.Fatalf("round-trip mismatch:\n got=%#v\nwant=%#v", got, v)
	}
}

func TestRowCodecRoundTrip(t *testing.T) {
	r := rand.New(rand.NewSource(1))

	// Zero values for every shape.
	roundTrip(t, rtWide{})
	roundTrip(t, rtPlain{})
	roundTrip(t, podRow{})

	// Explicit edge cases: empty strings, nil pointers, nil vs empty slices/maps.
	roundTrip(t, rtWide{Name: "", Labels: nil, Taints: nil})
	roundTrip(t, rtWide{Labels: map[string]string{}, Taints: []rtTaint{}})
	roundTrip(t, rtWide{Replicas: i32(0), Toggle: bp(false), Scale: &rtScale{}})

	for i := 0; i < 500; i++ {
		roundTrip(t, randWide(r))
		roundTrip(t, rtPlain{A: randStr(r), B: r.Int63(), C: r.Intn(2) == 0})
		roundTrip(t, podRow{
			uid:       randStr(r),
			namespace: randStr(r),
			name:      randStr(r),
			status:    randStr(r),
			cpu:       int64(r.Intn(1000)),
		})
	}
}

// TestStringColumnPromotionPreservesRoundTrip drives a string column past the
// near-unique promotion threshold (a unique uid + a unique name per row, > the
// promote-min-rows floor) and asserts that:
//   - the affected columns actually promote (storage switched to plain []string), and
//   - every row still round-trips exactly across the promotion boundary, AND a full
//     paginated query still matches a map shadow.
//
// This locks in that the layout switch is value-preserving (byte-identical behavior).
// It uses memRow (exported string fields, so they are interned/promotable) — podRow's
// fields are unexported and therefore never interned.
func TestStringColumnPromotionPreservesRoundTrip(t *testing.T) {
	codec := newRowCodec[memRow]()
	cs := newColumnStore[memRow](codec)
	shadow := map[string]memRow{}

	const n = 5000 // comfortably above promoteMinRows so unique columns promote
	for i := 0; i < n; i++ {
		row := memRow{
			memMeta:   memMeta{ClusterID: "c1", ClusterName: "Cluster One"},
			UID:       fmt.Sprintf("uid-%06d", i), // unique -> should promote
			Kind:      []string{"Deployment", "Pod"}[i%2],
			Group:     "apps",
			Version:   "v1",
			Namespace: fmt.Sprintf("ns-%d", i%20),    // low-card -> stays interned
			Name:      fmt.Sprintf("workload-%d", i), // unique -> should promote
			Status:    []string{"Running", "Pending", "Failed"}[i%3],
			Age:       []string{"5m", "1h", "2d"}[i%3],
			Restarts:  int32(i % 7),
			AgeMillis: int64(i),
		}
		cs.put(row.UID, row)
		shadow[row.UID] = row
	}

	// Identify which string fields promoted by their leaf field name.
	promoted := map[string]bool{}
	rt := codec.typ
	for _, fc := range codec.fields {
		if fc.kind != fieldString {
			continue
		}
		name := rt.FieldByIndex(fc.index).Name
		promoted[name] = fc.promoted
	}
	for _, unique := range []string{"UID", "Name"} {
		if !promoted[unique] {
			t.Fatalf("expected unique column %q to promote, promoted=%v", unique, promoted)
		}
	}
	for _, lowCard := range []string{"Namespace", "Status", "Kind"} {
		if promoted[lowCard] {
			t.Fatalf("expected low-cardinality column %q to stay interned, promoted=%v", lowCard, promoted)
		}
	}

	// Every row round-trips exactly after promotion.
	for uid, want := range shadow {
		got, ok := cs.get(uid)
		if !ok {
			t.Fatalf("missing uid %s after promotion", uid)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("post-promotion round-trip mismatch for %s:\n got=%#v\nwant=%#v", uid, got, want)
		}
	}

	// Updating a promoted-column row in place still round-trips.
	updated := shadow["uid-000010"]
	updated.Name = "renamed-after-promotion"
	cs.put(updated.UID, updated)
	shadow[updated.UID] = updated
	if got, _ := cs.get(updated.UID); !reflect.DeepEqual(got, updated) {
		t.Fatalf("update after promotion mismatch: got=%#v want=%#v", got, updated)
	}

	// Deleting then re-inserting a recycled rowId in a promoted column stays exact.
	cs.delete("uid-000020")
	delete(shadow, "uid-000020")
	reborn := memRow{memMeta: memMeta{ClusterID: "c1", ClusterName: "Cluster One"}, UID: "uid-999999", Kind: "Pod", Group: "apps", Version: "v1", Namespace: "ns-1", Name: "fresh", Status: "Running", Age: "1m"}
	cs.put(reborn.UID, reborn)
	shadow[reborn.UID] = reborn
	if got, _ := cs.get(reborn.UID); !reflect.DeepEqual(got, reborn) {
		t.Fatalf("recycled-row round-trip mismatch: got=%#v want=%#v", got, reborn)
	}
}

// TestColumnarStoreMatchesMapBaseline runs random Upsert/Delete ops + random queries
// and asserts the columnar-backed Store matches a plain map[string]R shadow for
// rows/order/total/facets.
func TestColumnarStoreMatchesMapBaseline(t *testing.T) {
	r := rand.New(rand.NewSource(3))
	schema := podSchema()
	store := NewStore(schema)
	shadow := map[string]podRow{}

	namespaces := []string{"default", "kube-system", "app"}
	statuses := []string{"Running", "Pending", "Failed"}
	sorts := []string{"name", "cpu"}
	dirs := []Direction{Ascending, Descending}

	for step := 0; step < 4000; step++ {
		uid := fmt.Sprintf("u%02d", r.Intn(50))
		if r.Intn(5) == 0 {
			store.Delete(uid)
			delete(shadow, uid)
		} else {
			row := podRow{
				uid:       uid,
				namespace: namespaces[r.Intn(len(namespaces))],
				name:      fmt.Sprintf("pod-%02d-%d", r.Intn(50), r.Intn(3)),
				status:    statuses[r.Intn(len(statuses))],
				cpu:       int64(r.Intn(10)),
			}
			store.Upsert(row)
			shadow[uid] = row
		}

		if store.Len() != len(shadow) {
			t.Fatalf("step %d: Len engine=%d shadow=%d", step, store.Len(), len(shadow))
		}

		if step%7 != 0 {
			continue
		}

		q := Query{
			ClusterID: "c",
			Signature: fmt.Sprintf("s%d", step),
			Sort:      sorts[r.Intn(len(sorts))],
			Direction: dirs[r.Intn(len(dirs))],
			Limit:     1 + r.Intn(9),
		}
		if r.Intn(2) == 0 {
			q.Filters = map[string][]string{"namespace": {namespaces[r.Intn(len(namespaces))]}}
		}
		if r.Intn(3) == 0 {
			q.Search = fmt.Sprintf("pod-%02d", r.Intn(50))
		}

		assertColumnarMatchesShadow(t, store, shadow, schema, q, step)
	}
}

// assertColumnarMatchesShadow paginates the engine fully and compares the ordered
// rows, total, and facets against an independent recompute over the map shadow.
func assertColumnarMatchesShadow(t *testing.T, store *Store[podRow], shadow map[string]podRow, schema Schema[podRow], q Query, step int) {
	t.Helper()
	gt := &groundTruth{schema: schema, rows: shadow}
	wantKeys, wantTotal, wantFacets := gt.query(q)

	var gotKeys []string
	var gotRows []podRow
	pq := q
	for guard := 0; ; guard++ {
		if guard > 100000 {
			t.Fatalf("step %d: pagination did not terminate", step)
		}
		page, err := store.Query(pq)
		if err != nil {
			t.Fatalf("step %d: query: %v", step, err)
		}
		for _, row := range page.Rows {
			gotKeys = append(gotKeys, schema.UID(row))
			gotRows = append(gotRows, row)
		}
		if page.NextCursor == "" {
			if page.Total != wantTotal {
				t.Fatalf("step %d: total engine=%d shadow=%d", step, page.Total, wantTotal)
			}
			for fname, m := range wantFacets {
				if len(page.Facets[fname]) != len(m) {
					t.Fatalf("step %d: facet %q size mismatch", step, fname)
				}
				for v, c := range m {
					if page.Facets[fname][v] != c {
						t.Fatalf("step %d: facet %q[%q] engine=%d shadow=%d", step, fname, v, page.Facets[fname][v], c)
					}
				}
			}
			break
		}
		pq.Cursor = page.NextCursor
	}

	if !equalStrs(gotKeys, wantKeys) {
		t.Fatalf("step %d sort=%s dir=%s: keys engine=%v shadow=%v", step, q.Sort, q.Direction, gotKeys, wantKeys)
	}
	// Every returned row must equal the shadow row for its uid (full reconstruction).
	for _, row := range gotRows {
		if want := shadow[schema.UID(row)]; !reflect.DeepEqual(row, want) {
			t.Fatalf("step %d: row %s engine=%#v shadow=%#v", step, schema.UID(row), row, want)
		}
	}
}

// memRow mirrors a realistic production row's shape and cardinality: a handful of
// low-cardinality string columns (cluster identity, kind, namespace, status, the age
// label, group/version), two unique-per-row columns (uid, name), and a few numeric
// columns. Interning's win is on the low-cardinality columns; the unique columns are
// where a dict cannot help (and where the prototype keeps a plain column).
type memRow struct {
	memMeta
	UID       string
	Kind      string
	Group     string
	Version   string
	Namespace string
	Name      string
	Status    string
	Age       string
	Restarts  int32
	AgeMillis int64
}

type memMeta struct {
	ClusterID   string
	ClusterName string
}

// TestColumnarMemoryFootprint mirrors storebench/memory_test.go: it logs the
// resident bytes/row of the columnar store versus a map[string]R baseline at 100k
// rows for a realistic row shape, asserting only a loose ceiling. It is a
// measurement, not a correctness gate.
//
// Fairness: each store generates its OWN fresh row strings INSIDE the measured
// build, so each pays for exactly the string backing it retains. A map retains every
// unique string's bytes; the columnar store dedups them through its per-column
// dictionaries — so the comparison reflects interning's real effect, not a
// pre-allocation artifact. The low-cardinality columns (cluster identity, kind,
// group, version, status, age) are where interning wins; the unique columns (uid,
// name) are where a dict cannot help.
func TestColumnarMemoryFootprint(t *testing.T) {
	if testing.Short() {
		t.Skip("memory measurement skipped in -short")
	}
	const n = 100_000

	namespaces := make([]string, 50)
	for i := range namespaces {
		namespaces[i] = fmt.Sprintf("ns-%d", i)
	}
	statuses := []string{"Running", "Pending", "Failed", "Succeeded", "CrashLoopBackOff"}
	kinds := []string{"Deployment", "StatefulSet", "DaemonSet", "Pod", "Job"}
	ages := []string{"5m", "1h", "3h", "2d", "14d", "90d"}

	// genRow builds one fresh row, allocating new strings for the unique columns so the
	// retained backing is attributed to whichever store keeps it.
	genRow := func(r *rand.Rand, i int) memRow {
		return memRow{
			memMeta:   memMeta{ClusterID: "cluster-prod-1", ClusterName: "Production US-East"},
			UID:       fmt.Sprintf("uid-%036d", i), // unique, UUID-length
			Kind:      kinds[r.Intn(len(kinds))],
			Group:     "apps",
			Version:   "v1",
			Namespace: namespaces[r.Intn(len(namespaces))],
			Name:      fmt.Sprintf("workload-%d", i), // unique-per-row
			Status:    statuses[r.Intn(len(statuses))],
			Age:       ages[r.Intn(len(ages))],
			Restarts:  int32(r.Intn(50)),
			AgeMillis: int64(r.Intn(1 << 30)),
		}
	}

	measure := func(build func()) uint64 {
		runtime.GC()
		var before runtime.MemStats
		runtime.ReadMemStats(&before)
		build()
		runtime.GC()
		var after runtime.MemStats
		runtime.ReadMemStats(&after)
		return after.HeapAlloc - before.HeapAlloc
	}

	codec := newRowCodec[memRow]()
	var cs *columnStore[memRow]
	colUsed := measure(func() {
		r := rand.New(rand.NewSource(1))
		cs = newColumnStore[memRow](codec)
		for i := 0; i < n; i++ {
			row := genRow(r, i)
			cs.put(row.UID, row)
		}
	})
	runtime.KeepAlive(cs)

	var m map[string]memRow
	mapUsed := measure(func() {
		r := rand.New(rand.NewSource(1))
		m = make(map[string]memRow, n)
		for i := 0; i < n; i++ {
			row := genRow(r, i)
			m[row.UID] = row
		}
	})
	runtime.KeepAlive(m)

	colPer := float64(colUsed) / float64(n)
	mapPer := float64(mapUsed) / float64(n)
	t.Logf("columnStore @ %d rows: %.1f MB, %.1f bytes/row", n, float64(colUsed)/1e6, colPer)
	t.Logf("map baseline @ %d rows: %.1f MB, %.1f bytes/row", n, float64(mapUsed)/1e6, mapPer)
	t.Logf("=> columnar uses %.1f%% of the map footprint", 100*colPer/mapPer)

	if colPer > 2000 {
		t.Fatalf("columnar footprint %.1f bytes/row exceeds the 2000-byte sanity ceiling", colPer)
	}
}
