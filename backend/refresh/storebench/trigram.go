package storebench

import (
	"strings"
	"sync"
)

// TrigramIndex is a minimal substring-search prototype: a trigram inverted index
// (trigram -> set of rowIds) with verify-after-intersect to drop false positives.
// It answers the v2 risk: can filter-as-you-type stay sub-frame at 1M rows, and
// what does maintaining the index cost per write?
//
// Postings are map-of-sets (O(1) add/remove) rather than compressed bitmaps; that
// over-spends memory but is faithful for measuring QUERY latency and per-event
// maintenance cost, which is what gates the design. (A real engine would use
// roaring bitmaps for the postings to make the index fit in memory at 1M.)
type TrigramIndex struct {
	mu       sync.RWMutex
	postings map[uint32]map[uint32]struct{} // trigram -> set of rowIds
	names    map[uint32]string              // rowId -> lowercased name
}

// NewTrigramIndex builds an empty index sized for an expected row count.
func NewTrigramIndex(expected int) *TrigramIndex {
	return &TrigramIndex{
		postings: make(map[uint32]map[uint32]struct{}),
		names:    make(map[uint32]string, expected),
	}
}

// appendTrigrams appends the distinct 3-byte trigrams of s (assumed lowercased)
// to dst. Strings shorter than 3 bytes contribute none (callers fall back to a
// linear scan for sub-trigram queries — the UI requires >=3 chars in practice).
func appendTrigrams(dst []uint32, s string) []uint32 {
	for i := 0; i+3 <= len(s); i++ {
		tg := uint32(s[i])<<16 | uint32(s[i+1])<<8 | uint32(s[i+2])
		dup := false
		for _, e := range dst {
			if e == tg {
				dup = true
				break
			}
		}
		if !dup {
			dst = append(dst, tg)
		}
	}
	return dst
}

func (t *TrigramIndex) add(rowID uint32, lower string) {
	t.names[rowID] = lower
	for _, tg := range appendTrigrams(nil, lower) {
		set := t.postings[tg]
		if set == nil {
			set = make(map[uint32]struct{})
			t.postings[tg] = set
		}
		set[rowID] = struct{}{}
	}
}

func (t *TrigramIndex) remove(rowID uint32) {
	lower, ok := t.names[rowID]
	if !ok {
		return
	}
	for _, tg := range appendTrigrams(nil, lower) {
		if set := t.postings[tg]; set != nil {
			delete(set, rowID)
			if len(set) == 0 {
				delete(t.postings, tg)
			}
		}
	}
	delete(t.names, rowID)
}

// Add indexes a new row's name.
func (t *TrigramIndex) Add(rowID uint32, name string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.add(rowID, strings.ToLower(name))
}

// Update re-indexes a row whose name changed (remove old trigrams, add new).
func (t *TrigramIndex) Update(rowID uint32, name string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.remove(rowID)
	t.add(rowID, strings.ToLower(name))
}

// Remove drops a row from the index.
func (t *TrigramIndex) Remove(rowID uint32) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.remove(rowID)
}

// Search returns up to limit rowIds whose name contains sub (case-insensitive).
// It intersects the query's trigram posting sets (smallest first) and verifies the
// actual substring on each candidate to eliminate trigram false positives.
func (t *TrigramIndex) Search(sub string, limit int) []uint32 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	lower := strings.ToLower(sub)
	tgs := appendTrigrams(nil, lower)

	if len(tgs) == 0 { // sub shorter than a trigram: linear fallback
		out := make([]uint32, 0, limit)
		for rowID, name := range t.names {
			if strings.Contains(name, lower) {
				out = append(out, rowID)
				if len(out) >= limit {
					break
				}
			}
		}
		return out
	}

	// Pick the smallest posting set among the query trigrams to iterate.
	var smallest map[uint32]struct{}
	for _, tg := range tgs {
		p := t.postings[tg]
		if p == nil {
			return nil // a query trigram is absent -> no matches
		}
		if smallest == nil || len(p) < len(smallest) {
			smallest = p
		}
	}

	out := make([]uint32, 0, limit)
	for rowID := range smallest {
		inAll := true
		for _, tg := range tgs {
			if _, present := t.postings[tg][rowID]; !present {
				inAll = false
				break
			}
		}
		if inAll && strings.Contains(t.names[rowID], lower) {
			out = append(out, rowID)
			if len(out) >= limit {
				break
			}
		}
	}
	return out
}
