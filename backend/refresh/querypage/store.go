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
//
// UID is the store's unique row key AND the tie order for equal sort values
// (ascLess/descLess tie-break by it, ascending in both directions), so its shape is
// user-visible whenever sort values collide: give it a human-meaningful form — the
// typed tables use the lowercased kind/namespace/name adapter key, the catalog its
// identity chain — never an arbitrary identifier like the Kubernetes object UID.
// Pinned by TestTiedSortValuesOrderByHumanKey.
type Schema[R any] struct {
	UID              func(R) string
	SortKeys         map[string]func(R) string
	Facets           map[string]func(R) string
	MultiFacets      map[string]func(R) []string
	FacetNormalizers map[string]func(string) string
	SearchText       func(R) string
}

func uniqueFacetValues(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	unique := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
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
	MatchNone bool                // explicit empty multiselect: no row can match
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

	// CursorInvalid reports that the request's cursor was rejected — undecodable,
	// pinned to a different query shape, or an un-navigable backward dead end (a
	// valid prev-page cursor whose predecessors were all deleted). The served page
	// is a first-page restart for the first two, and the empty dead-end page for
	// the last; callers forward the flag so the client resets its pagination
	// state. Owning this in the engine keeps every executor's degrade behavior
	// identical — callers need no cursor pre-validation of their own.
	CursorInvalid bool

	// PageStartRank is the 0-based rank of the served page's first row among the
	// query's matching rows — exact position honesty for the footer. Counted
	// serves (QueryAround/QueryAt) fill it; the cursor-based Query path returns
	// -1 (not computed — the O(rank) walk it would cost is gated behind the P9
	// benchmark). The wire layer maps ≥0 to a pointer so rank 0 survives
	// omitempty.
	PageStartRank int

	// SelfCursor addresses THIS page: a later plain Query with it reproduces the
	// window (the page-stability primitive live refetches use after an anchored
	// or offset landing — cursor-addressed pages already hold their own request
	// token). Counted serves mint it from the entry preceding the window; "" for
	// a first-page window, whose address is the empty token.
	SelfCursor string
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

// Store is the generic Query → Page engine for one kind. It holds rows in an
// interned columnar store keyed by UID, a b-tree keyset index per sort order, and
// exact facet counters, all maintained incrementally on Upsert/Delete. It is generic
// over R via the Schema extractors — the engine carries no per-kind logic.
//
// Row storage is a columnStore (see columnar.go): a structure-of-arrays with
// dictionary-interned string columns and a recycled rowId arena, replacing a plain
// map[string]R. To avoid an O(N)-reconstruction-per-query regression, the Schema's
// match inputs (facet values + lowercased SearchText) are extracted ONCE per row at
// Upsert time and cached by rowId in `matchByRowID`, so Query filters/searches and
// the filtered-Total scan read those cached values instead of reconstructing rows.
// Full rows are reconstructed via the codec only for the page actually returned, for
// Snapshot, and for the deindex of a replaced/deleted row.
type Store[R any] struct {
	mu     sync.RWMutex
	schema Schema[R]
	rows   *columnStore[R]
	match  map[uint32]matchValues // by rowId: precomputed facet values + lowercased search text
	idx    map[string]*sortIndex
	facets map[string]map[string]int

	// tri is a trigram inverted index over each row's lowercased SearchText, keyed by the
	// same rowId as `match`, maintained in lockstep under s.mu on Upsert/Delete. A search
	// of >= 3 chars uses it to narrow which rows get the strings.Contains verify (the
	// trigram set is a SUPERSET, so the verify still decides membership — results, order,
	// and cursors stay identical to a linear scan). It is nil for read-only (mmap-aliased,
	// Cold) stores, whose whole point is off-heap column data; those fall back to a linear
	// scan (Cold is not the hot search path).
	tri *trigramIndex

	// readOnly marks a store whose columns ALIAS a memory mapping (the Tier 2.6 dual-mode
	// Cold-serving store): it answers Query but ignores Upsert/Delete, because mutating
	// mmap-aliased columns is invalid and a Cold cluster is never fed (a re-warm builds a
	// fresh mutable heap store instead). A normal store leaves this false.
	readOnly bool
}

// NewStore builds an empty store for a schema, creating a per-direction index per
// sort key and the columnar row store (codec built by reflecting over R's zero value).
func NewStore[R any](schema Schema[R]) *Store[R] {
	s := &Store[R]{
		schema: schema,
		rows:   newColumnStore[R](newRowCodec[R]()),
		match:  make(map[uint32]matchValues),
		idx:    make(map[string]*sortIndex, len(schema.SortKeys)),
		facets: make(map[string]map[string]int, len(schema.Facets)+len(schema.MultiFacets)),
		tri:    newTrigramIndex(0),
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
	for name := range schema.MultiFacets {
		if _, exists := s.facets[name]; exists {
			panic(fmt.Sprintf("querypage: facet %q is both single- and multi-valued", name))
		}
		s.facets[name] = make(map[string]int)
	}
	return s
}

// Upsert inserts or replaces a row, maintaining every index + facet incrementally. A
// read-only (mmap-aliased) store ignores writes — see Store.readOnly.
func (s *Store[R]) Upsert(row R) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly {
		return
	}
	s.upsertLocked(row)
}

func (s *Store[R]) upsertLocked(row R) {
	uid := s.schema.UID(row)
	if old, ok := s.rows.get(uid); ok {
		s.deindex(uid, old)
	}
	rowID := s.rows.put(uid, row)
	mv := extractMatchValues(s.schema, row)
	s.match[rowID] = mv
	// Maintain the trigram index in lockstep with `match`, keyed by the same rowID and the
	// same lowercased search text. update = remove-then-add, so it re-keys an in-place
	// replace and clears any prior occupant's trigrams on a recycled rowID.
	if s.tri != nil {
		s.tri.update(rowID, mv.searchText)
	}
	s.reindex(uid, row)
}

// ReplaceWhere replaces the rows owned by one source with rows from that source,
// preserving rows owned by other sources. Passing owns=nil replaces the whole
// store. It is the batch counterpart to Upsert/Delete for reflector relists:
// rebuild derived indexes/facets once from the post-relist row set instead of
// issuing N incremental updates through downstream sinks.
func (s *Store[R]) ReplaceWhere(rows []R, owns func(R) bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly {
		return
	}
	next := make([]R, 0, len(rows)+s.rows.len())
	if owns != nil {
		s.rows.forEach(func(_ string, row R) bool {
			if !owns(row) {
				next = append(next, row)
			}
			return true
		})
	}
	next = append(next, rows...)
	s.replaceAllLocked(next)
}

func (s *Store[R]) replaceAllLocked(rows []R) {
	s.rows = newColumnStore[R](newRowCodec[R]())
	s.match = make(map[uint32]matchValues, len(rows))
	s.idx = make(map[string]*sortIndex, len(s.schema.SortKeys))
	for name := range s.schema.SortKeys {
		s.idx[name] = &sortIndex{
			asc:  btree.NewG[indexEntry](32, ascLess),
			desc: btree.NewG[indexEntry](32, descLess),
		}
	}
	s.facets = make(map[string]map[string]int, len(s.schema.Facets)+len(s.schema.MultiFacets))
	for name := range s.schema.Facets {
		s.facets[name] = make(map[string]int)
	}
	for name := range s.schema.MultiFacets {
		s.facets[name] = make(map[string]int)
	}
	if s.tri != nil {
		s.tri = newTrigramIndex(len(rows))
	}
	for _, row := range rows {
		s.upsertLocked(row)
	}
}

// Delete removes a row by UID, maintaining every index + facet incrementally. A read-only
// (mmap-aliased) store ignores deletes — see Store.readOnly.
func (s *Store[R]) Delete(uid string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readOnly {
		return
	}
	if old, ok := s.rows.get(uid); ok {
		s.deindex(uid, old)
		rowID, _ := s.rows.delete(uid)
		delete(s.match, rowID)
		// Drop the freed rowID's trigrams so a recycled rowID never carries them.
		if s.tri != nil {
			s.tri.remove(rowID)
		}
	}
}

// Len reports the number of stored rows.
func (s *Store[R]) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.rows.len()
}

// Snapshot returns a copy of every stored row (unordered) under a read lock. It
// lets a caller hand the store's current rows to another consumer (e.g. a
// scope-filtered re-query) without exposing the internal store.
func (s *Store[R]) Snapshot() []R {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]R, 0, s.rows.len())
	s.rows.forEach(func(_ string, r R) bool {
		out = append(out, r)
		return true
	})
	return out
}

func (s *Store[R]) reindex(uid string, row R) {
	for name, get := range s.schema.SortKeys {
		s.idx[name].insert(indexEntry{val: get(row), uid: uid})
	}
	for name, get := range s.schema.Facets {
		s.facets[name][get(row)]++
	}
	for name, get := range s.schema.MultiFacets {
		for _, value := range uniqueFacetValues(get(row)) {
			s.facets[name][value]++
		}
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
	for name, get := range s.schema.MultiFacets {
		for _, value := range uniqueFacetValues(get(row)) {
			if s.facets[name][value] <= 1 {
				delete(s.facets[name], value)
			} else {
				s.facets[name][value]--
			}
		}
	}
}

// searchCandidates precomputes, ONCE per query, the trigram candidate set for a search
// term: the superset of rowIDs that MIGHT contain the term, or nil to mean "no trigram
// narrowing — run the linear strings.Contains on every row". It returns nil when the
// term is empty/<3 chars (no trigrams) or when the store has no trigram index (read-only
// Cold stores), so those callers keep the current linear-scan behavior. When non-nil, the
// caller gates the Contains check on membership (a rowID absent from the set cannot match,
// so its Contains call is skipped; a present rowID still gets verified).
func (s *Store[R]) searchCandidates(searchLower string) (set map[uint32]struct{}, narrow bool) {
	if s.tri == nil || len(searchLower) < 3 {
		return nil, false
	}
	return s.tri.searchSet(searchLower), true
}

// matchValuesMatches tests a query's filters + search against a row's precomputed
// match cache (facet values + lowercased search text), so no row is reconstructed to
// answer a filter/search. `searchLower` is the query's search term, pre-lowered once
// by the caller. `rowID` identifies the row and `candidates`/`narrow` is the trigram
// gate from searchCandidates (narrow=false ⇒ linear scan). It mirrors the previous
// rowMatches semantics exactly: the trigram set only narrows which rows get the Contains
// verify, the verify still decides membership.
func (s *Store[R]) matchValuesMatches(rowID uint32, mv matchValues, filters map[string][]string, searchLower string, candidates map[uint32]struct{}, narrow bool) bool {
	// Query's filters + search are exactly a scope base + search, so the two share one
	// matcher (scopeMatchesBase) and can never diverge.
	return s.scopeMatchesBase(rowID, mv, filters, searchLower, candidates, narrow)
}

func (s *Store[R]) normalizeFacetFilters(filters map[string][]string) map[string][]string {
	if len(filters) == 0 || len(s.schema.FacetNormalizers) == 0 {
		return filters
	}
	normalized := make(map[string][]string, len(filters))
	for name, allowed := range filters {
		normalize := s.schema.FacetNormalizers[name]
		if normalize == nil {
			normalized[name] = allowed
			continue
		}
		values := make([]string, len(allowed))
		for i, value := range allowed {
			values[i] = normalize(value)
		}
		normalized[name] = uniqueFacetValues(values)
	}
	return normalized
}

// scopeMatchesBase tests a row's cached match values against a base filter set +
// search using the SAME logic as matchValuesMatches. It takes the base filters and a
// pre-lowered search directly (rather than a full Query) so Scope and Query share one
// matcher and can never diverge. Filters here carry the same semantics as Query.Filters
// (OR within a facet, AND across facets); an empty allowed list for a facet is ignored.
// `rowID` + `candidates`/`narrow` carry the trigram gate (see searchCandidates): when
// narrow is true the rowID must be in candidates to even attempt the Contains verify.
func (s *Store[R]) scopeMatchesBase(rowID uint32, mv matchValues, base map[string][]string, searchLower string, candidates map[uint32]struct{}, narrow bool) bool {
	for fname, allowed := range base {
		if len(allowed) == 0 {
			continue
		}
		_, isSingleFacet := s.schema.Facets[fname]
		_, isMultiFacet := s.schema.MultiFacets[fname]
		if !isSingleFacet && !isMultiFacet {
			return false
		}
		matched := false
		if isSingleFacet {
			value := mv.facets[fname]
			if normalized, ok := mv.normalizedFacets[fname]; ok {
				value = normalized
			}
			for _, candidate := range allowed {
				if value == candidate {
					matched = true
					break
				}
			}
		} else {
			values := mv.multiFacets[fname]
			if normalized, ok := mv.normalizedMultiFacets[fname]; ok {
				values = normalized
			}
			for _, value := range values {
				for _, candidate := range allowed {
					if value == candidate {
						matched = true
						break
					}
				}
				if matched {
					break
				}
			}
		}
		if !matched {
			return false
		}
	}
	if searchLower != "" {
		if s.schema.SearchText == nil {
			return false
		}
		// Trigram narrowing: a rowID absent from the candidate superset cannot contain the
		// term, so skip its Contains call. When narrow is false (no index / <3-char term)
		// every row falls through to the linear Contains verify, exactly as before.
		if narrow {
			if _, ok := candidates[rowID]; !ok {
				return false
			}
		}
		if !strings.Contains(mv.searchText, searchLower) {
			return false
		}
	}
	return true
}

// Scope returns, over the rows matching `base` filters + `search`, the per-facet
// value→count map and the total — computed from the by-rowId match cache WITHOUT
// reconstructing any row. Same filter/search semantics as Query (OR within a facet,
// AND across facets; case-insensitive substring search). The facet values are the
// raw values the schema's facet extractor produced (e.g. lowercased), matching the
// stored match cache. This is the cheap O(N)-no-reconstruction count a direct serve
// uses for facets + UnfilteredTotal.
func (s *Store[R]) Scope(base map[string][]string, search string) (map[string]map[string]int, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	searchLower := strings.ToLower(search)
	base = s.normalizeFacetFilters(base)
	candidates, narrow := s.searchCandidates(searchLower)
	counts := make(map[string]map[string]int, len(s.facets))
	for name := range s.facets {
		counts[name] = make(map[string]int)
	}
	total := 0
	for rowID, mv := range s.match {
		if !s.scopeMatchesBase(rowID, mv, base, searchLower, candidates, narrow) {
			continue
		}
		total++
		for name, value := range mv.facets {
			counts[name][value]++
		}
		for name, values := range mv.multiFacets {
			for _, value := range values {
				counts[name][value]++
			}
		}
	}
	return counts, total
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

	// Cursor handling never errors a serve: a token that fails to decode or pins a
	// different query shape restarts from the first page with CursorInvalid set, so
	// a stale client degrades to page 1 instead of a failed request.
	cursorInvalid := false
	cur, err := Decode(q.Cursor)
	if err != nil || cur.Validate(q.ClusterID, q.Signature, q.Sort, q.Direction, limit) != nil {
		cur = Cursor{}
		cursorInvalid = true
	}

	hasPivot := !cur.IsFirstPage()
	backward := hasPivot && cur.Backward
	pivot := indexEntry{val: cur.Position, uid: cur.UID}

	matchesUID, filters, searchLower, candidates, narrow := s.matcherFor(q)

	// Collect up to limit+1 matching entries from the pivot, in walk order, so the
	// limit+1th tells us whether a further page exists on the walked side.
	entries := make([]indexEntry, 0, limit+1)
	collect := func(e indexEntry) bool {
		if hasPivot && e.val == pivot.val && e.uid == pivot.uid {
			return true // the boundary row itself already appeared on the adjacent page
		}
		if !matchesUID(e.uid) {
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
	// A valid backward cursor that collected nothing means every predecessor was
	// deleted since the token was minted — an un-navigable dead end, not a page.
	// Flag it so the client restarts at page 1. (Owned here, not per-caller, so
	// typed and catalog executors cannot diverge on the rule.)
	if backward && len(entries) == 0 {
		cursorInvalid = true
	}
	if backward {
		// The downward walk produced reverse order; flip to forward (display) order.
		for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
			entries[i], entries[j] = entries[j], entries[i]
		}
	}

	// Reconstruct full rows ONLY for the page actually returned (not for every scanned
	// or filtered row), via the codec.
	rows := make([]R, len(entries))
	for i, e := range entries {
		rows[i], _ = s.rows.get(e.uid)
	}

	// Boundary cursors. NextCursor pins the last row (forward), PrevCursor pins the
	// first row (backward). Existence on the WALKED side comes from `overflow`; on the
	// side we came FROM, a page always exists (we navigated here from it): a forward
	// page reached via a non-first cursor has a prev; a backward page always has a next.
	next, prev := "", ""
	if len(entries) > 0 {
		first, last := entries[0], entries[len(entries)-1]
		if backward {
			if overflow {
				prev = s.pinCursor(q, limit, first, true)
			}
			next = s.pinCursor(q, limit, last, false)
		} else {
			if overflow {
				next = s.pinCursor(q, limit, last, false)
			}
			if hasPivot {
				prev = s.pinCursor(q, limit, first, true)
			}
		}
	}

	facets, total := s.facetsAndTotal(q, filters, searchLower, candidates, narrow)

	return Page[R]{Rows: rows, NextCursor: next, PrevCursor: prev, Facets: facets, Total: total, CursorInvalid: cursorInvalid, PageStartRank: -1}, nil
}

// matcherFor returns the per-UID match predicate for one query plus the lowered
// search term and trigram gate it closes over — the matching context shared by
// Query, QueryAround, and QueryAt. Callers must hold s.mu.
//
// The search term is lowered once; matchValuesMatches compares it against each
// row's pre-lowered cached SearchText, so neither side is re-lowered per row.
// The trigram candidate superset is precomputed ONCE per query (no limit, so a
// sort walk can reach any matching row in cursor order); narrow=false for
// <3-char terms or read-only stores ⇒ the per-row check falls back to the
// linear Contains verify. A uid present in a sort index always has a cached
// match entry (maintained in lockstep by Upsert/Delete).
func (s *Store[R]) matcherFor(q Query) (matchesUID func(string) bool, filters map[string][]string, searchLower string, candidates map[uint32]struct{}, narrow bool) {
	filters = s.normalizeFacetFilters(q.Filters)
	searchLower = strings.ToLower(q.Search)
	candidates, narrow = s.searchCandidates(searchLower)
	matchesUID = func(uid string) bool {
		if q.MatchNone {
			return false
		}
		rowID, ok := s.rows.rowID(uid)
		if !ok {
			return false
		}
		return s.matchValuesMatches(rowID, s.match[rowID], filters, searchLower, candidates, narrow)
	}
	return matchesUID, filters, searchLower, candidates, narrow
}

// facetsAndTotal returns the unfiltered facet counter copy and the query's exact
// total — the unfiltered live count, or a column-only scan over the cached match
// values when filters/search are present (no row reconstruction). The Page tail
// shared by every serve entry point. Callers must hold s.mu.
func (s *Store[R]) facetsAndTotal(q Query, filters map[string][]string, searchLower string, candidates map[uint32]struct{}, narrow bool) (map[string]map[string]int, int) {
	total := s.rows.len()
	if q.MatchNone {
		total = 0
	} else if len(q.Filters) > 0 || q.Search != "" {
		total = 0
		for rowID, mv := range s.match {
			if s.matchValuesMatches(rowID, mv, filters, searchLower, candidates, narrow) {
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
	return facets, total
}

// pinCursor mints the opaque boundary cursor for one index entry under q's
// pinned query shape.
func (s *Store[R]) pinCursor(q Query, limit int, e indexEntry, back bool) string {
	c := FirstPage(q.ClusterID, q.Signature, q.Sort, q.Direction, limit)
	c.Position = e.val
	c.UID = e.uid
	c.Backward = back
	return c.Encode()
}

// AnchorOutcome reports how QueryAround resolved its anchor row under the
// query's filters — the engine-level truth the serve layer maps to the
// contract's user-visible "filtered" / "not-found" reasons.
type AnchorOutcome struct {
	// Found: the anchor row exists AND matches the query's filters/search;
	// Rank is then its 0-based position among matching rows in display order.
	Found bool
	// Filtered: the anchor row exists in the store but the query's
	// filters/search exclude it. Mutually exclusive with Found.
	Filtered bool
	// Rank is valid only when Found; -1 otherwise.
	Rank int
}

// QueryAround serves the PAGE-ALIGNED window containing the row whose schema
// UID equals anchorKey, under q's sort, direction, filters, and search — the
// engine primitive behind "jump to this object in the list". One counted
// O(rank + limit) walk (plus skipped non-matching entries) yields the exact
// 0-based rank, the aligned window (pageStart = rank - rank%limit), and
// ordinary keyset prev/next cursors minted from the window boundaries — so
// pagination after a jump is indistinguishable from pagination that arrived
// from page 1, and rank is derived per request, never stored. A missing or
// filtered-out anchor serves the FIRST page instead (one round trip, sane
// landing) with the outcome saying why. q.Cursor is ignored: anchor and
// continue are mutually exclusive at the contract layer.
func (s *Store[R]) QueryAround(q Query, anchorKey string) (Page[R], AnchorOutcome, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	si, ok := s.idx[q.Sort]
	if !ok {
		return Page[R]{}, AnchorOutcome{Rank: -1}, fmt.Errorf("querypage: unknown sort %q", q.Sort)
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	matchesUID, filters, searchLower, candidates, narrow := s.matcherFor(q)

	// Resolve the anchor BEFORE walking: an O(1) presence + match check under
	// the same RLock as the walk (no found-then-vanished race within a serve),
	// and an absent anchor skips the counted walk entirely.
	outcome := AnchorOutcome{Rank: -1}
	if rowID, present := s.rows.rowID(anchorKey); present {
		if !q.MatchNone && s.matchValuesMatches(rowID, s.match[rowID], filters, searchLower, candidates, narrow) {
			outcome.Found = true
		} else {
			outcome.Filtered = true
		}
	}

	index := si.forDirection(q.Direction)
	var window []indexEntry
	var selfPivot indexEntry
	pageStart := 0
	overflow := false
	hasSelfPivot := false
	if outcome.Found {
		window, pageStart, outcome.Rank, overflow, selfPivot, hasSelfPivot = countedAnchorWindow(index, limit, matchesUID, anchorKey)
	} else {
		window, overflow, selfPivot, hasSelfPivot = countedOffsetWindow(index, limit, 0, matchesUID)
	}

	page := s.buildCountedPage(q, limit, window, pageStart, overflow, selfPivot, hasSelfPivot)
	page.Facets, page.Total = s.facetsAndTotal(q, filters, searchLower, candidates, narrow)
	return page, outcome, nil
}

// QueryAt serves the page starting at startRank (0-based) among matching rows —
// the bounded offset contract behind numbered page jumps. startRank is clamped
// to the last page-aligned start (negatives to 0) so a stale page number lands
// on the nearest real page instead of an empty one; the served start is
// reported on Page.PageStartRank. q.Cursor is ignored.
func (s *Store[R]) QueryAt(q Query, startRank int) (Page[R], error) {
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
	matchesUID, filters, searchLower, candidates, narrow := s.matcherFor(q)

	// The exact filtered total is needed for the Page tail anyway; computing it
	// first lets the clamp use it without a second scan.
	facets, total := s.facetsAndTotal(q, filters, searchLower, candidates, narrow)
	if startRank < 0 || total == 0 {
		startRank = 0
	} else if last := ((total - 1) / limit) * limit; startRank > last {
		startRank = last
	}

	index := si.forDirection(q.Direction)
	window, overflow, selfPivot, hasSelfPivot := countedOffsetWindow(index, limit, startRank, matchesUID)
	page := s.buildCountedPage(q, limit, window, startRank, overflow, selfPivot, hasSelfPivot)
	page.Facets, page.Total = facets, total
	return page, nil
}

// buildCountedPage reconstructs the window's rows and mints its boundary
// cursors: prev exists iff the window starts past rank 0, next iff the walk
// probed one further match past the window, and self (from the entry
// preceding the window) addresses the window itself for page-stable refetch.
// Facets/Total are filled by the caller (shared facetsAndTotal); CursorInvalid
// is never set on counted serves.
func (s *Store[R]) buildCountedPage(q Query, limit int, window []indexEntry, pageStart int, overflow bool, selfPivot indexEntry, hasSelfPivot bool) Page[R] {
	rows := make([]R, len(window))
	for i, e := range window {
		rows[i], _ = s.rows.get(e.uid)
	}
	next, prev, self := "", "", ""
	if len(window) > 0 {
		if overflow {
			next = s.pinCursor(q, limit, window[len(window)-1], false)
		}
		if pageStart > 0 {
			prev = s.pinCursor(q, limit, window[0], true)
		}
	}
	if hasSelfPivot {
		self = s.pinCursor(q, limit, selfPivot, false)
	}
	return Page[R]{Rows: rows, NextCursor: next, PrevCursor: prev, PageStartRank: pageStart, SelfCursor: self}
}

// countedAnchorWindow walks the direction index in display order counting
// matching rows, buffering the current page of up to limit entries and
// clearing the buffer at each page boundary, until the anchor lands in the
// buffer; it then fills the page and probes for one further match (overflow ⇒
// a next page exists). selfPivot is the last entry of the page BEFORE the
// window (captured at the final buffer clear) — the window's own keyset
// address. The caller guarantees the anchor matches, so the walk always
// terminates at the anchor's page in O(rank + limit) matching steps.
func countedAnchorWindow(index *btree.BTreeG[indexEntry], limit int, matches func(string) bool, anchorKey string) (window []indexEntry, pageStart, rank int, overflow bool, selfPivot indexEntry, hasSelfPivot bool) {
	window = make([]indexEntry, 0, limit)
	count := 0
	rank = -1
	index.Ascend(func(e indexEntry) bool {
		if !matches(e.uid) {
			return true
		}
		if rank >= 0 && len(window) == limit {
			overflow = true
			return false
		}
		if rank < 0 && len(window) == limit {
			selfPivot = window[limit-1]
			hasSelfPivot = true
			window = window[:0]
			pageStart = count
		}
		window = append(window, e)
		if e.uid == anchorKey {
			rank = count
		}
		count++
		return true
	})
	return window, pageStart, rank, overflow, selfPivot, hasSelfPivot
}

// countedOffsetWindow counts matching rows up to startRank, collects up to
// limit entries from there, and probes for one further match (overflow ⇒ a
// next page exists). selfPivot is the matching entry at rank startRank-1 (the
// window's keyset address); absent when the window starts at rank 0.
func countedOffsetWindow(index *btree.BTreeG[indexEntry], limit, startRank int, matches func(string) bool) (window []indexEntry, overflow bool, selfPivot indexEntry, hasSelfPivot bool) {
	window = make([]indexEntry, 0, limit)
	count := 0
	index.Ascend(func(e indexEntry) bool {
		if !matches(e.uid) {
			return true
		}
		if count >= startRank {
			if len(window) == limit {
				overflow = true
				return false
			}
			window = append(window, e)
		} else if count == startRank-1 {
			selfPivot = e
			hasSelfPivot = true
		}
		count++
		return true
	})
	return window, overflow, selfPivot, hasSelfPivot
}
