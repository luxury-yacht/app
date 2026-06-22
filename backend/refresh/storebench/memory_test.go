package storebench

import (
	"math/rand"
	"runtime"
	"testing"
)

// TestColumnarMemoryFootprint reports the resident heap of the columnar store at
// 1M objects — the load-bearing number for the "many clusters open" goal: how many
// 1M-object clusters fit in RAM before cold-cluster spill is needed. It is a
// measurement (logged), asserting only a loose sanity ceiling.
func TestColumnarMemoryFootprint(t *testing.T) {
	if testing.Short() {
		t.Skip("memory measurement skipped in -short")
	}
	const n = 1_000_000
	r := rand.New(rand.NewSource(1))
	objs := genObjects(n, r) // allocated before the baseline, so not counted

	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	cs := NewColumnarStore(n)
	for _, o := range objs {
		cs.Upsert(o)
	}

	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	runtime.KeepAlive(cs)

	used := after.HeapAlloc - before.HeapAlloc
	perObj := float64(used) / float64(n)
	t.Logf("columnar store @ %d objects: %.0f MB total, %.1f bytes/object", n, float64(used)/1e6, perObj)
	t.Logf("=> ~%.0f such 1M-object clusters fit in a 4 GB store budget", 4e9/float64(used))

	if perObj > 1000 {
		t.Fatalf("footprint %.1f bytes/object exceeds the 1000-byte sanity ceiling", perObj)
	}
}
