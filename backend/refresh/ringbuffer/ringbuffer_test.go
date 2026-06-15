package ringbuffer

import (
	"reflect"
	"testing"
)

type seqItem struct {
	seq uint64
}

func newSeqBuffer(max int) *Buffer[seqItem] {
	return New(max, func(i seqItem) uint64 { return i.seq })
}

func seqs(items []seqItem) []uint64 {
	out := make([]uint64, len(items))
	for i, it := range items {
		out[i] = it.seq
	}
	return out
}

func TestSinceEmptyBuffer(t *testing.T) {
	b := newSeqBuffer(4)
	if items, ok := b.Since(0); ok || items != nil {
		t.Fatalf("empty buffer: got %v ok=%v, want nil,false", items, ok)
	}
}

func TestSinceReturnsNewerItems(t *testing.T) {
	b := newSeqBuffer(8)
	for _, s := range []uint64{1, 2, 3} {
		b.Add(seqItem{seq: s})
	}
	items, ok := b.Since(1)
	if !ok {
		t.Fatal("expected ok")
	}
	if got := seqs(items); !reflect.DeepEqual(got, []uint64{2, 3}) {
		t.Fatalf("got %v, want [2 3]", got)
	}
}

func TestSinceAlreadyCurrentReturnsEmptyNonNil(t *testing.T) {
	b := newSeqBuffer(8)
	b.Add(seqItem{seq: 1})
	b.Add(seqItem{seq: 2})
	items, ok := b.Since(2)
	if !ok {
		t.Fatal("expected ok")
	}
	if items == nil || len(items) != 0 {
		t.Fatalf("got %v, want empty non-nil slice", items)
	}
}

func TestSinceTooOldReturnsFalse(t *testing.T) {
	b := newSeqBuffer(2)
	// Capacity 2: adding 1..3 evicts seq 1, so oldest retained is 2.
	for _, s := range []uint64{1, 2, 3} {
		b.Add(seqItem{seq: s})
	}
	if items, ok := b.Since(1); ok || items != nil {
		t.Fatalf("resume below oldest: got %v ok=%v, want nil,false", items, ok)
	}
	// Oldest retained (2) is satisfiable: everything after it is seq 3.
	items, ok := b.Since(2)
	if !ok || !reflect.DeepEqual(seqs(items), []uint64{3}) {
		t.Fatalf("got %v ok=%v, want [3],true", items, ok)
	}
}

func TestAddEvictsOldestWhenFull(t *testing.T) {
	b := newSeqBuffer(3)
	for _, s := range []uint64{10, 20, 30, 40, 50} {
		b.Add(seqItem{seq: s})
	}
	// Only the last 3 remain; replaying from before the window fails, from 30 succeeds.
	if _, ok := b.Since(20); ok {
		t.Fatal("expected resume below window to fail")
	}
	items, ok := b.Since(30)
	if !ok || !reflect.DeepEqual(seqs(items), []uint64{40, 50}) {
		t.Fatalf("got %v ok=%v, want [40 50],true", items, ok)
	}
}

func TestAllReturnsItemsInOrderAfterWraparound(t *testing.T) {
	b := newSeqBuffer(3)
	for _, s := range []uint64{1, 2, 3, 4, 5} {
		b.Add(seqItem{seq: s})
	}
	// Capacity 3 after 5 adds: oldest-first is 3,4,5 regardless of internal start.
	if got := seqs(b.All()); !reflect.DeepEqual(got, []uint64{3, 4, 5}) {
		t.Fatalf("got %v, want [3 4 5]", got)
	}
}

func TestZeroCapacityDropsEverything(t *testing.T) {
	b := newSeqBuffer(0)
	b.Add(seqItem{seq: 1})
	if items, ok := b.Since(0); ok || items != nil {
		t.Fatalf("zero-cap: got %v ok=%v, want nil,false", items, ok)
	}
}
