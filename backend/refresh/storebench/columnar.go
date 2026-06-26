// Package storebench is Prototype #1 (see docs/architecture/data-layer.md,
// "Provenance"): the write-path benchmark that gated the v2 store decision. It implements a
// minimal-but-faithful version of the proposed OWNED columnar write path —
// dictionary-interned structure-of-arrays columns in a recycled rowId arena,
// sorted indexes over (sortKey, uid), and exact facet counters — so we can
// measure whether sustained ingest + churn holds up at 100k–1M objects before
// committing to building the real engine.
//
// This is benchmark scaffolding, not production code: it models one kind's
// columns (a pod-like row) and two sort orders (CPU, memory). The question it
// answers is narrow and load-bearing: does an incrementally-maintained columnar
// Append keep per-event cost O(log N) across its index fan-out and sustain a
// churn storm, versus the naive "rebuild + full sort per query" baseline.
package storebench

import (
	"sync"

	"github.com/google/btree"
)

// Object is a minimal pod-like row for the benchmark.
type Object struct {
	UID       string
	Namespace string
	Name      string
	CPUMilli  int64
	MemBytes  int64
	Status    string
}

// sortEntry is one index entry: the comparable sort value plus the row id as a
// stable tiebreak, exactly as the v2 design specifies (value-keyed, not offset).
// The same shape backs every per-kind index (CPU, memory, …).
type sortEntry struct {
	val   int64
	rowID uint32
}

func sortEntryLess(a, b sortEntry) bool {
	if a.val != b.val {
		return a.val < b.val
	}
	return a.rowID < b.rowID
}

// ColumnarStore is the proposed owned write path, minimized to one kind.
type ColumnarStore struct {
	// mu guards all state. Writes take Lock; bounded-page reads take RLock. The
	// critical sections are microseconds (one O(log N) mutation per index; one
	// O(log N + page) scan), so contention stays low even under churn. NOTE:
	// lock-free LONG reads (export / cursor-walk-all) would need column MVCC —
	// they cannot read columns off-lock while a writer mutates in place; that's
	// the remaining hard problem.
	mu sync.RWMutex

	rowByUID map[string]uint32
	freeRows []uint32

	// Columns (structure-of-arrays), indexed by rowId. High-cardinality columns
	// are dictionary-interned to uint32 ids (zero-pointer slices for the GC).
	namespaceID []uint32
	name        []string
	cpu         []int64
	mem         []int64
	statusID    []uint32
	live        []bool

	// Dictionary interning.
	nsDict     map[string]uint32
	nsValues   []string
	statusDict map[string]uint32
	statusVals []string

	// Sorted indexes over (value, rowID); value-keyed keysets for O(log N + page).
	// A real kind has several (name, cpu, memory, age, status…); two here is enough
	// to measure the per-event multi-index fan-out cost.
	cpuIndex *btree.BTreeG[sortEntry]
	memIndex *btree.BTreeG[sortEntry]

	// Exact per-namespace facet counters (id -> count).
	nsCounts map[uint32]int
}

// NewColumnarStore builds an empty store sized for an expected row count.
func NewColumnarStore(expected int) *ColumnarStore {
	return &ColumnarStore{
		rowByUID:    make(map[string]uint32, expected),
		namespaceID: make([]uint32, 0, expected),
		name:        make([]string, 0, expected),
		cpu:         make([]int64, 0, expected),
		mem:         make([]int64, 0, expected),
		statusID:    make([]uint32, 0, expected),
		live:        make([]bool, 0, expected),
		nsDict:      make(map[string]uint32),
		statusDict:  make(map[string]uint32),
		cpuIndex:    btree.NewG[sortEntry](32, sortEntryLess),
		memIndex:    btree.NewG[sortEntry](32, sortEntryLess),
		nsCounts:    make(map[uint32]int),
	}
}

func intern(dict map[string]uint32, vals *[]string, v string) uint32 {
	if id, ok := dict[v]; ok {
		return id
	}
	id := uint32(len(*vals))
	*vals = append(*vals, v)
	dict[v] = id
	return id
}

func (s *ColumnarStore) allocRow() uint32 {
	if n := len(s.freeRows); n > 0 {
		id := s.freeRows[n-1]
		s.freeRows = s.freeRows[:n-1]
		return id
	}
	id := uint32(len(s.live))
	s.namespaceID = append(s.namespaceID, 0)
	s.name = append(s.name, "")
	s.cpu = append(s.cpu, 0)
	s.mem = append(s.mem, 0)
	s.statusID = append(s.statusID, 0)
	s.live = append(s.live, false)
	return id
}

// Upsert inserts or updates an object, maintaining every index + facet
// incrementally — the per-event work the v2 store relies on (O(log N) per index,
// never O(N)).
func (s *ColumnarStore) Upsert(o Object) {
	s.mu.Lock()
	defer s.mu.Unlock()
	nsID := intern(s.nsDict, &s.nsValues, o.Namespace)
	stID := intern(s.statusDict, &s.statusVals, o.Status)

	if rowID, ok := s.rowByUID[o.UID]; ok {
		// Update: only touch an index if its sort key actually changed.
		if s.cpu[rowID] != o.CPUMilli {
			s.cpuIndex.Delete(sortEntry{val: s.cpu[rowID], rowID: rowID})
			s.cpuIndex.ReplaceOrInsert(sortEntry{val: o.CPUMilli, rowID: rowID})
			s.cpu[rowID] = o.CPUMilli
		}
		if s.mem[rowID] != o.MemBytes {
			s.memIndex.Delete(sortEntry{val: s.mem[rowID], rowID: rowID})
			s.memIndex.ReplaceOrInsert(sortEntry{val: o.MemBytes, rowID: rowID})
			s.mem[rowID] = o.MemBytes
		}
		// Facets move only if the namespace changed (rare).
		if s.namespaceID[rowID] != nsID {
			s.nsCounts[s.namespaceID[rowID]]--
			s.nsCounts[nsID]++
			s.namespaceID[rowID] = nsID
		}
		s.name[rowID] = o.Name
		s.statusID[rowID] = stID
		return
	}

	rowID := s.allocRow()
	s.rowByUID[o.UID] = rowID
	s.namespaceID[rowID] = nsID
	s.name[rowID] = o.Name
	s.cpu[rowID] = o.CPUMilli
	s.mem[rowID] = o.MemBytes
	s.statusID[rowID] = stID
	s.live[rowID] = true
	s.cpuIndex.ReplaceOrInsert(sortEntry{val: o.CPUMilli, rowID: rowID})
	s.memIndex.ReplaceOrInsert(sortEntry{val: o.MemBytes, rowID: rowID})
	s.nsCounts[nsID]++
}

// Delete removes an object, maintaining every index + facet incrementally.
func (s *ColumnarStore) Delete(uid string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rowID, ok := s.rowByUID[uid]
	if !ok {
		return
	}
	s.cpuIndex.Delete(sortEntry{val: s.cpu[rowID], rowID: rowID})
	s.memIndex.Delete(sortEntry{val: s.mem[rowID], rowID: rowID})
	s.nsCounts[s.namespaceID[rowID]]--
	s.live[rowID] = false
	delete(s.rowByUID, uid)
	s.freeRows = append(s.freeRows, rowID)
}

// Len reports the number of live rows.
func (s *ColumnarStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.rowByUID)
}

// TopByCPU returns up to limit rows with the highest CPU (descending) — the
// keyset page read: a bounded range scan over the sorted index, O(log N + page),
// never a full sort.
func (s *ColumnarStore) TopByCPU(limit int) []Object {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Object, 0, limit)
	s.cpuIndex.Descend(func(e sortEntry) bool {
		out = append(out, Object{
			Namespace: s.nsValues[s.namespaceID[e.rowID]],
			Name:      s.name[e.rowID],
			CPUMilli:  s.cpu[e.rowID],
			MemBytes:  s.mem[e.rowID],
			Status:    s.statusVals[s.statusID[e.rowID]],
		})
		return len(out) < limit
	})
	return out
}

// NamespaceCount returns the exact live count for a namespace — an O(1) facet
// read, the win over re-counting N rows per query.
func (s *ColumnarStore) NamespaceCount(ns string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.nsDict[ns]
	if !ok {
		return 0
	}
	return s.nsCounts[id]
}
