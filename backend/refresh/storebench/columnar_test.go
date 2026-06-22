package storebench

import (
	"fmt"
	"math/rand"
	"sort"
	"sync"
	"testing"
	"time"
)

// naiveStore models the current "hold all rows + full sort per query" approach:
// O(1) writes but an O(N log N) sort on every read.
type naiveStore struct {
	rows map[string]Object
}

func newNaiveStore() *naiveStore { return &naiveStore{rows: map[string]Object{}} }

func (s *naiveStore) Upsert(o Object)   { s.rows[o.UID] = o }
func (s *naiveStore) Delete(uid string) { delete(s.rows, uid) }

func (s *naiveStore) TopByCPU(limit int) []Object {
	all := make([]Object, 0, len(s.rows))
	for _, o := range s.rows {
		all = append(all, o)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].CPUMilli != all[j].CPUMilli {
			return all[i].CPUMilli > all[j].CPUMilli
		}
		return all[i].UID < all[j].UID
	})
	if len(all) > limit {
		all = all[:limit]
	}
	return all
}

func genObjects(n int, r *rand.Rand) []Object {
	namespaces := make([]string, 50)
	for i := range namespaces {
		namespaces[i] = fmt.Sprintf("ns-%d", i)
	}
	statuses := []string{"Running", "Pending", "Failed", "Succeeded", "CrashLoopBackOff"}
	objs := make([]Object, n)
	for i := range objs {
		objs[i] = Object{
			UID:       fmt.Sprintf("uid-%d", i),
			Namespace: namespaces[r.Intn(len(namespaces))],
			Name:      fmt.Sprintf("pod-%d", i),
			CPUMilli:  int64(r.Intn(4000)),
			MemBytes:  int64(r.Intn(1 << 30)),
			Status:    statuses[r.Intn(len(statuses))],
		}
	}
	return objs
}

// TestColumnarMatchesNaive is the property gate (graft from the plan's B-design):
// after an arbitrary sequence of upserts/updates/deletes, the columnar store's
// incrementally-maintained index + facets must equal a fresh recompute (the naive
// store). Uses unique CPU values so the top-K ordering is unambiguous.
func TestColumnarMatchesNaive(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	const n = 3000
	namespaces := []string{"a", "b", "c", "d"}

	var cpuCounter int64
	nextCPU := func() int64 { cpuCounter++; return cpuCounter }

	cs := NewColumnarStore(n)
	naive := newNaiveStore()
	uids := make([]string, n)
	for i := 0; i < n; i++ {
		uids[i] = fmt.Sprintf("uid-%d", i)
		o := Object{UID: uids[i], Namespace: namespaces[r.Intn(4)], Name: fmt.Sprintf("p-%d", i), CPUMilli: nextCPU(), Status: "Running"}
		cs.Upsert(o)
		naive.Upsert(o)
	}
	for i := 0; i < 1000; i++ { // updates: new unique CPU + maybe new namespace
		uid := uids[r.Intn(n)]
		o := Object{UID: uid, Namespace: namespaces[r.Intn(4)], Name: "p", CPUMilli: nextCPU(), Status: "Pending"}
		cs.Upsert(o)
		naive.Upsert(o)
	}
	for i := 0; i < 400; i++ { // deletes
		uid := uids[r.Intn(n)]
		cs.Delete(uid)
		naive.Delete(uid)
	}

	if cs.Len() != len(naive.rows) {
		t.Fatalf("len mismatch: columnar=%d naive=%d", cs.Len(), len(naive.rows))
	}
	got := cs.TopByCPU(200)
	want := naive.TopByCPU(200)
	if len(got) != len(want) {
		t.Fatalf("top-K len mismatch: got=%d want=%d", len(got), len(want))
	}
	for i := range got {
		if got[i].CPUMilli != want[i].CPUMilli {
			t.Fatalf("cpu order mismatch @%d: got=%d want=%d", i, got[i].CPUMilli, want[i].CPUMilli)
		}
	}
	counts := map[string]int{}
	for _, o := range naive.rows {
		counts[o.Namespace]++
	}
	for ns, c := range counts {
		if cs.NamespaceCount(ns) != c {
			t.Fatalf("facet mismatch ns=%s: columnar=%d want=%d", ns, cs.NamespaceCount(ns), c)
		}
	}
}

func benchSizes() []int { return []int{100_000, 1_000_000} }

// BenchmarkColumnarUpsertChurn measures per-event write cost under a churn storm
// (each event changes an object's sort key). This is the load-bearing question:
// does the owned write path stay O(log N) per event at 100k–1M?
func BenchmarkColumnarUpsertChurn(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			r := rand.New(rand.NewSource(1))
			objs := genObjects(n, r)
			cs := NewColumnarStore(n)
			for _, o := range objs {
				cs.Upsert(o)
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				o := objs[i%n]
				o.CPUMilli = int64(r.Intn(4000)) // churn: changes one sort key (cpu)
				cs.Upsert(o)
			}
		})
	}
}

// BenchmarkColumnarMultiIndexChurn changes BOTH sort keys (cpu + memory) each
// event, so every write fans out to both indexes — the realistic per-kind cost.
// Comparing it to BenchmarkColumnarUpsertChurn (one index touched) shows how
// per-event cost scales with the number of indexes a kind maintains.
func BenchmarkColumnarMultiIndexChurn(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			r := rand.New(rand.NewSource(1))
			objs := genObjects(n, r)
			cs := NewColumnarStore(n)
			for _, o := range objs {
				cs.Upsert(o)
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				o := objs[i%n]
				o.CPUMilli = int64(r.Intn(4000))
				o.MemBytes = int64(r.Intn(1 << 30))
				cs.Upsert(o)
			}
		})
	}
}

// BenchmarkColumnarTopByCPU measures the keyset page read (bounded range scan).
func BenchmarkColumnarTopByCPU(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			r := rand.New(rand.NewSource(1))
			objs := genObjects(n, r)
			cs := NewColumnarStore(n)
			for _, o := range objs {
				cs.Upsert(o)
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = cs.TopByCPU(250)
			}
		})
	}
}

// BenchmarkNaiveTopByCPU measures the current approach's read cost: a full sort
// of all N rows per query. The gap to BenchmarkColumnarTopByCPU is the win.
func BenchmarkNaiveTopByCPU(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			r := rand.New(rand.NewSource(1))
			objs := genObjects(n, r)
			ns := newNaiveStore()
			for _, o := range objs {
				ns.Upsert(o)
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = ns.TopByCPU(250)
			}
		})
	}
}

// BenchmarkColumnarReadUnderChurn measures bounded-page read latency while a
// writer churns the store at full speed concurrently — the cursor-stability /
// concurrency question. The gap to BenchmarkColumnarTopByCPU (no contention) is
// the price of the RWMutex critical sections.
func BenchmarkColumnarReadUnderChurn(b *testing.B) {
	for _, n := range benchSizes() {
		b.Run(fmt.Sprintf("N=%d", n), func(b *testing.B) {
			r := rand.New(rand.NewSource(1))
			objs := genObjects(n, r)
			cs := NewColumnarStore(n)
			for _, o := range objs {
				cs.Upsert(o)
			}
			stop := make(chan struct{})
			var wg sync.WaitGroup
			wg.Add(1)
			go func() {
				defer wg.Done()
				wr := rand.New(rand.NewSource(2))
				for i := 0; ; i++ {
					select {
					case <-stop:
						return
					default:
						o := objs[i%n]
						o.CPUMilli = int64(wr.Intn(4000))
						cs.Upsert(o)
					}
				}
			}()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = cs.TopByCPU(250)
			}
			b.StopTimer()
			close(stop)
			wg.Wait()
		})
	}
}

// TestColumnarConcurrentSafety runs concurrent writers + readers (upsert, delete,
// page read, facet read, len) so `go test -race` proves the store has no data
// races and no torn reads under concurrency. It asserts the invariant that every
// page is CPU-descending (a torn read would break ordering); exact values are
// racing by design, so -race + invariant + no panic is the gate.
func TestColumnarConcurrentSafety(t *testing.T) {
	r := rand.New(rand.NewSource(3))
	const n = 5000
	objs := genObjects(n, r)
	cs := NewColumnarStore(n)
	for _, o := range objs {
		cs.Upsert(o)
	}

	stop := make(chan struct{})
	var wg sync.WaitGroup

	for w := 0; w < 3; w++ { // writers: mix of updates + deletes (rowId recycling)
		wg.Add(1)
		go func(seed int64) {
			defer wg.Done()
			wr := rand.New(rand.NewSource(seed))
			for {
				select {
				case <-stop:
					return
				default:
				}
				idx := wr.Intn(n)
				if wr.Intn(4) == 0 {
					cs.Delete(objs[idx].UID)
				} else {
					o := objs[idx]
					o.CPUMilli = int64(wr.Intn(4000))
					o.Namespace = fmt.Sprintf("ns-%d", wr.Intn(50))
					cs.Upsert(o)
				}
			}
		}(int64(w + 10))
	}

	for rd := 0; rd < 4; rd++ { // readers
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				page := cs.TopByCPU(250)
				for i := 1; i < len(page); i++ {
					if page[i].CPUMilli > page[i-1].CPUMilli {
						t.Errorf("torn read: page not CPU-descending at %d (%d > %d)", i, page[i].CPUMilli, page[i-1].CPUMilli)
						return
					}
				}
				_ = cs.NamespaceCount("ns-0")
				_ = cs.Len()
			}
		}()
	}

	time.Sleep(150 * time.Millisecond)
	close(stop)
	wg.Wait()
}
