package querypage

import (
	"fmt"
	"strings"
	"sync"

	"github.com/google/btree"
)

// Schema describes how the engine reads a stored row of type R: how to identify it,
// which sort orders and facets it exposes, and what text is searchable. Sort and
// facet values are strings; numeric sorts must be encoded order-preservingly by the
// extractor (e.g. zero-padded), so lexical order matches numeric order.
type Schema[R any] struct {
	UID        func(R) string
	SortKeys   map[string]func(R) string
	Facets     map[string]func(R) string
	SearchText func(R) string
}

// Query is one page request against a kind's store.
type Query struct {
	ClusterID string
	Signature string // identifies the query shape (filters+scope); pins the cursor
	Sort      string // a key in Schema.SortKeys
	Direction Direction
	Limit     int
	Search    string              // case-insensitive substring filter over SearchText
	Filters   map[string][]string // facet filters: facet name -> allowed values (set membership; OR within, AND across facets)
	Cursor    string              // opaque continueToken from a previous Page
}

// Page is one page of results plus the (unfiltered) facet counts, the total number
// of rows matching filters+search, and the cursors for the next/prev page ("" when
// there is no page in that direction).
type Page[R any] struct {
	Rows       []R
	NextCursor string
	PrevCursor string
	Facets     map[string]map[string]int
	Total      int
}

// indexEntry is one sorted-index entry: a string sort value plus the row UID as the
// always-unique tiebreak — the value-keyed keyset the unified cursor pages over.
type indexEntry struct {
	val string
	uid string
}

// ascLess orders ascending by value, tie-broken by UID ascending.
func ascLess(a, b indexEntry) bool {
	if a.val != b.val {
		return a.val < b.val
	}
	return a.uid < b.uid
}

// descLess orders DESCENDING by value but keeps the UID tiebreak ASCENDING. This
// matches the live typed-table total order (typed_table_query.go:313) exactly, so a
// descending page lays tied rows out identically — a drop-in cutover, not a reorder.
// Maintaining one index per direction lets every query walk it the same ascending
// way (Ascend / AscendGreaterOrEqual), regardless of sort direction.
func descLess(a, b indexEntry) bool {
	if a.val != b.val {
		return a.val > b.val
	}
	return a.uid < b.uid
}

// sortIndex holds both direction orderings for one sort key.
type sortIndex struct {
	asc  *btree.BTreeG[indexEntry]
	desc *btree.BTreeG[indexEntry]
}

func (si *sortIndex) forDirection(d Direction) *btree.BTreeG[indexEntry] {
	if d == Descending {
		return si.desc
	}
	return si.asc
}

func (si *sortIndex) insert(e indexEntry) {
	si.asc.ReplaceOrInsert(e)
	si.desc.ReplaceOrInsert(e)
}

func (si *sortIndex) remove(e indexEntry) {
	si.asc.Delete(e)
	si.desc.Delete(e)
}

// Store is the generic Query → Page engine for one kind. It holds rows by UID, a
// b-tree keyset index per sort order, and exact facet counters, all maintained
// incrementally on Upsert/Delete. It is generic over R via the Schema extractors —
// the engine carries no per-kind logic.
type Store[R any] struct {
	mu     sync.RWMutex
	schema Schema[R]
	rows   map[string]R
	idx    map[string]*sortIndex
	facets map[string]map[string]int
}

// NewStore builds an empty store for a schema, creating a per-direction index per
// sort key.
func NewStore[R any](schema Schema[R]) *Store[R] {
	s := &Store[R]{
		schema: schema,
		rows:   make(map[string]R),
		idx:    make(map[string]*sortIndex, len(schema.SortKeys)),
		facets: make(map[string]map[string]int, len(schema.Facets)),
	}
	for name := range schema.SortKeys {
		s.idx[name] = &sortIndex{
			asc:  btree.NewG[indexEntry](32, ascLess),
			desc: btree.NewG[indexEntry](32, descLess),
		}
	}
	for name := range schema.Facets {
		s.facets[name] = make(map[string]int)
	}
	return s
}

// Upsert inserts or replaces a row, maintaining every index + facet incrementally.
func (s *Store[R]) Upsert(row R) {
	s.mu.Lock()
	defer s.mu.Unlock()
	uid := s.schema.UID(row)
	if old, ok := s.rows[uid]; ok {
		s.deindex(uid, old)
	}
	s.rows[uid] = row
	s.reindex(uid, row)
}

// Delete removes a row by UID, maintaining every index + facet incrementally.
func (s *Store[R]) Delete(uid string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.rows[uid]; ok {
		s.deindex(uid, old)
		delete(s.rows, uid)
	}
}

// Len reports the number of stored rows.
func (s *Store[R]) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.rows)
}

// Snapshot returns a copy of every stored row (unordered) under a read lock. It
// lets a caller hand the store's current rows to another consumer (e.g. a
// scope-filtered re-query) without exposing the internal map.
func (s *Store[R]) Snapshot() []R {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]R, 0, len(s.rows))
	for _, r := range s.rows {
		out = append(out, r)
	}
	return out
}

func (s *Store[R]) reindex(uid string, row R) {
	for name, get := range s.schema.SortKeys {
		s.idx[name].insert(indexEntry{val: get(row), uid: uid})
	}
	for name, get := range s.schema.Facets {
		s.facets[name][get(row)]++
	}
}

func (s *Store[R]) deindex(uid string, row R) {
	for name, get := range s.schema.SortKeys {
		s.idx[name].remove(indexEntry{val: get(row), uid: uid})
	}
	for name, get := range s.schema.Facets {
		v := get(row)
		if s.facets[name][v] <= 1 {
			delete(s.facets[name], v)
		} else {
			s.facets[name][v]--
		}
	}
}

func (s *Store[R]) rowMatches(row R, q Query) bool {
	for fname, allowed := range q.Filters {
		if len(allowed) == 0 {
			continue
		}
		get := s.schema.Facets[fname]
		if get == nil {
			return false
		}
		v := get(row)
		matched := false
		for _, a := range allowed {
			if v == a {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if q.Search != "" {
		if s.schema.SearchText == nil {
			return false
		}
		if !strings.Contains(strings.ToLower(s.schema.SearchText(row)), strings.ToLower(q.Search)) {
			return false
		}
	}
	return true
}

// Query executes a page request: it seeks to the cursor position in the chosen
// sort index (O(log N)), walks in the requested direction collecting rows that pass
// the filters + search until the page is full, and returns the next cursor plus the
// facet counts and total match count.
func (s *Store[R]) Query(q Query) (Page[R], error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	si, ok := s.idx[q.Sort]
	if !ok {
		return Page[R]{}, fmt.Errorf("querypage: unknown sort %q", q.Sort)
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}

	cur, err := Decode(q.Cursor)
	if err != nil {
		return Page[R]{}, err
	}
	if cur.Validate(q.ClusterID, q.Signature, q.Sort, q.Direction, limit) != nil {
		cur = Cursor{} // stale / mismatched cursor -> restart from the first page
	}

	hasPivot := !cur.IsFirstPage()
	backward := hasPivot && cur.Backward
	pivot := indexEntry{uid: cur.UID}
	if hasPivot && len(cur.Position) > 0 {
		pivot.val = cur.Position[0]
	}

	// Collect up to limit+1 matching entries from the pivot, in walk order, so the
	// limit+1th tells us whether a further page exists on the walked side.
	entries := make([]indexEntry, 0, limit+1)
	collect := func(e indexEntry) bool {
		if hasPivot && e.val == pivot.val && e.uid == pivot.uid {
			return true // the boundary row itself already appeared on the adjacent page
		}
		if !s.rowMatches(s.rows[e.uid], q) {
			return true
		}
		entries = append(entries, e)
		return len(entries) <= limit
	}

	// One index per direction, both ordered so a forward (Ascend) walk reproduces the
	// live total order. A prev-page request walks the SAME index downward
	// (DescendLessOrEqual), collecting the rows immediately before the pivot.
	index := si.forDirection(q.Direction)
	switch {
	case backward:
		index.DescendLessOrEqual(pivot, collect)
	case hasPivot:
		index.AscendGreaterOrEqual(pivot, collect)
	default:
		index.Ascend(collect)
	}

	// overflow == a further page exists on the side we walked.
	overflow := len(entries) > limit
	if overflow {
		entries = entries[:limit]
	}
	if backward {
		// The downward walk produced reverse order; flip to forward (display) order.
		for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
			entries[i], entries[j] = entries[j], entries[i]
		}
	}

	rows := make([]R, len(entries))
	for i, e := range entries {
		rows[i] = s.rows[e.uid]
	}

	// Boundary cursors. NextCursor pins the last row (forward), PrevCursor pins the
	// first row (backward). Existence on the WALKED side comes from `overflow`; on the
	// side we came FROM, a page always exists (we navigated here from it): a forward
	// page reached via a non-first cursor has a prev; a backward page always has a next.
	pin := func(e indexEntry, back bool) string {
		c := FirstPage(q.ClusterID, q.Signature, q.Sort, q.Direction, limit)
		c.Position = []string{e.val}
		c.UID = e.uid
		c.Backward = back
		return c.Encode()
	}
	next, prev := "", ""
	if len(entries) > 0 {
		first, last := entries[0], entries[len(entries)-1]
		if backward {
			if overflow {
				prev = pin(first, true)
			}
			next = pin(last, false)
		} else {
			if overflow {
				next = pin(last, false)
			}
			if hasPivot {
				prev = pin(first, true)
			}
		}
	}

	total := len(s.rows)
	if len(q.Filters) > 0 || q.Search != "" {
		total = 0
		for _, row := range s.rows {
			if s.rowMatches(row, q) {
				total++
			}
		}
	}

	facets := make(map[string]map[string]int, len(s.facets))
	for name, counts := range s.facets {
		m := make(map[string]int, len(counts))
		for v, c := range counts {
			m[v] = c
		}
		facets[name] = m
	}

	return Page[R]{Rows: rows, NextCursor: next, PrevCursor: prev, Facets: facets, Total: total}, nil
}
