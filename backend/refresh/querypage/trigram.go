package querypage

// trigram.go ports the validated TrigramIndex prototype from
// backend/refresh/storebench/trigram.go into the querypage package so the Store's
// search path can narrow which rows get the strings.Contains verify.
//
// Differences from the prototype: it carries NO internal mutex, because every access
// happens under the owning Store.mu (Upsert/Delete hold the write lock, Query holds the
// read lock); and searchSet returns the FULL candidate set (no limit) because the Store's
// sort-index walk must be able to reach any matching row in cursor order, not just the
// first k. The postings are map-of-sets (a real engine would use roaring bitmaps); this
// is faithful for the substring-narrowing the Store needs.

// trigramIndex is a trigram inverted index (trigram -> set of rowIDs) over rows'
// lowercased searchable text, with verify-after-intersect left to the caller (the Store
// still runs strings.Contains on the candidates to drop trigram false positives).
type trigramIndex struct {
	postings map[uint32]map[uint32]struct{} // trigram -> set of rowIDs
	names    map[uint32]string              // rowID -> lowercased searchable text
}

// newTrigramIndex builds an empty index sized for an expected row count.
func newTrigramIndex(expected int) *trigramIndex {
	return &trigramIndex{
		postings: make(map[uint32]map[uint32]struct{}),
		names:    make(map[uint32]string, expected),
	}
}

// appendTrigrams appends the distinct 3-byte trigrams of s (assumed lowercased) to dst.
// Strings shorter than 3 bytes contribute none, so the caller falls back to a linear scan
// for sub-trigram queries.
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

// add indexes a row's lowercased text under its rowID.
func (t *trigramIndex) add(rowID uint32, lower string) {
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

// remove drops a rowID from the index. It is a no-op for an absent rowID, so update can
// call it unconditionally (a freshly-allocated rowID has no prior trigrams).
func (t *trigramIndex) remove(rowID uint32) {
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

// update re-indexes a rowID whose text changed (remove old trigrams, add new). On a
// recycled rowID the prior occupant's trigrams are dropped first, so a recycled rowID
// never carries a stale row's trigrams.
func (t *trigramIndex) update(rowID uint32, lower string) {
	t.remove(rowID)
	t.add(rowID, lower)
}

// searchSet returns the full set of candidate rowIDs whose text MIGHT contain sub: the
// rows present in every one of sub's trigram posting sets (verify-after-intersect by the
// caller drops false positives). It assumes sub is already lowercased and has >= 3 bytes
// (the caller checks len before calling); for a shorter sub it returns nil so the caller
// falls back to a linear scan. A nil return also means "no possible match" when a query
// trigram is absent — the two are distinguished by the caller checking len(sub) >= 3.
func (t *trigramIndex) searchSet(lower string) map[uint32]struct{} {
	tgs := appendTrigrams(nil, lower)
	if len(tgs) == 0 {
		return nil // sub shorter than a trigram: caller uses the linear scan
	}

	// Pick the smallest posting set among the query trigrams to iterate.
	var smallest map[uint32]struct{}
	for _, tg := range tgs {
		p := t.postings[tg]
		if p == nil {
			return map[uint32]struct{}{} // a query trigram is absent -> no matches
		}
		if smallest == nil || len(p) < len(smallest) {
			smallest = p
		}
	}

	out := make(map[uint32]struct{}, len(smallest))
	for rowID := range smallest {
		inAll := true
		for _, tg := range tgs {
			if _, present := t.postings[tg][rowID]; !present {
				inAll = false
				break
			}
		}
		if inAll {
			out[rowID] = struct{}{}
		}
	}
	return out
}
