package snapshot

import (
	"encoding/base64"
	"encoding/json"
	"sort"
	"strings"
)

// The bespoke sort→filter→slice typed-table executor, demoted to the TEST
// ORACLE it always effectively was (docs/architecture/data-layer.md invariant
// #1 — one query engine, one cursor codec): the querypage engine is the one
// production executor, and the parity gates in
// querypage_*_test.go compare it byte-identically against this
// straightforward recompute. Production reached this code only through a
// !query.Enabled guard that was itself unreachable (every caller pre-checks
// Enabled and routes window mode to truncateSnapshotWindow), so moving it
// here changes no behavior.

// typedTableQueryCursor is the LEGACY bespoke cursor shape, kept only so the
// oracle can exercise cursor-boundary semantics the same way the old executor
// did. Production cursors are querypage.Cursor (one unified codec).
type typedTableQueryCursor struct {
	ClusterID       string `json:"clusterId"`
	Table           string `json:"table"`
	Signature       string `json:"signature"`
	SortField       string `json:"sortField"`
	SortDirection   string `json:"sortDirection"`
	Limit           int    `json:"limit"`
	LastValue       string `json:"lastValue"`
	LastKey         string `json:"lastKey"`
	DynamicRevision string `json:"dynamicRevision,omitempty"`
}

// typedTableSortedItem decorates a row with its comparable sort value and row
// key, computed ONCE per row. Page order and the keyset cursor boundary both
// derive from this same (value, key) pair — see typedTableSortedItemLess.
type typedTableSortedItem[T any] struct {
	item  T
	value string
	key   string
}

func decorateTypedTableItem[T any](item T, query typedTableQuery, adapter typedTableQueryAdapter[T]) typedTableSortedItem[T] {
	return typedTableSortedItem[T]{
		item:  item,
		value: typedTableComparableSortValue(item, query.Request.SortField, adapter),
		key:   adapter.Key(item),
	}
}

// typedTableSortedItemLess is the oracle's total order for typed-table pages:
// the comparable sort value, tie-broken by the stable row key — the SAME
// (value, key) order the production engine reproduces via its schema sort
// values and adapter-key tiebreak (pinned by the parity gates and
// TestTiedSortValuesOrderByHumanKey). Row keys are unique, so the order is
// strict (no equal elements).
func typedTableSortedItemLess[T any](a, b typedTableSortedItem[T], desc bool) bool {
	if a.value != b.value {
		if desc {
			return a.value > b.value
		}
		return a.value < b.value
	}
	return a.key < b.key
}

// typedTableSortedItemAfterCursor reports whether the decorated row sorts
// strictly after the cursor position in the page walk order.
func typedTableSortedItemAfterCursor[T any](candidate typedTableSortedItem[T], cursor typedTableQueryCursor, desc bool) bool {
	if desc {
		return candidate.value < cursor.LastValue ||
			(candidate.value == cursor.LastValue && candidate.key > cursor.LastKey)
	}
	return candidate.value > cursor.LastValue ||
		(candidate.value == cursor.LastValue && candidate.key > cursor.LastKey)
}

func typedTableCursorFor[T any](last typedTableSortedItem[T], query typedTableQuery) string {
	return encodeTypedTableQueryCursor(typedTableQueryCursor{
		ClusterID:       query.Request.ClusterID,
		Table:           query.Request.Table,
		Signature:       query.signature(),
		SortField:       query.Request.SortField,
		SortDirection:   query.Request.SortDirection,
		Limit:           query.Request.Limit,
		LastValue:       last.value,
		LastKey:         last.key,
		DynamicRevision: query.DynamicRevision,
	})
}

func applyTypedTableQuery[T any](items []T, query typedTableQuery, adapter typedTableQueryAdapter[T]) typedTableQueryPage[T] {
	if !query.Enabled {
		return typedTableQueryPage[T]{
			Rows:            items,
			Total:           len(items),
			UnfilteredTotal: len(items),
			TotalIsExact:    true,
			FacetsExact:     true,
			Namespaces:      collectTypedTableFacet(items, adapter.Namespace),
			Kinds:           collectTypedTableFacet(items, adapter.Kind),
			FacetValues:     collectTypedTableFacetValues(items, adapter.Facets, true),
			Dynamic:         query.dynamicRef(),
		}
	}

	desc := query.Request.SortDirection == "desc"
	matcher := newTypedTableQueryMatcher(query, adapter)
	filtered := make([]typedTableSortedItem[T], 0, len(items))
	namespaceFacets := map[string]string{}
	kindFacets := map[string]string{}
	for _, item := range items {
		if !matcher.Matches(item) {
			continue
		}
		addTypedTableFacetValue(namespaceFacets, adapter.Namespace(item))
		addTypedTableFacetValue(kindFacets, adapter.Kind(item))
		filtered = append(filtered, decorateTypedTableItem(item, query, adapter))
	}

	// Row keys are unique → strict order → an unstable sort is equivalent.
	sort.Slice(filtered, func(i, j int) bool {
		return typedTableSortedItemLess(filtered[i], filtered[j], desc)
	})
	total := len(filtered)
	if query.Request.MatchNone {
		for _, item := range items {
			addTypedTableFacetValue(namespaceFacets, adapter.Namespace(item))
			addTypedTableFacetValue(kindFacets, adapter.Kind(item))
		}
	}

	start := 0
	cursorInvalid := false
	if query.Request.Continue != "" {
		if cursor, ok := decodeTypedTableQueryCursor(query.Request.Continue); ok && cursor.matches(query) {
			// The slice is sorted in walk order, so "after cursor" is monotone
			// and the boundary is a binary search.
			start = sort.Search(len(filtered), func(i int) bool {
				return typedTableSortedItemAfterCursor(filtered[i], cursor, desc)
			})
		} else {
			cursorInvalid = true
		}
	}

	end := min(start+query.Request.Limit, len(filtered))
	pageRows := make([]T, 0, end-start)
	for _, candidate := range filtered[start:end] {
		pageRows = append(pageRows, candidate.item)
	}
	continueToken := ""
	if end < len(filtered) && len(pageRows) > 0 {
		continueToken = typedTableCursorFor(filtered[end-1], query)
	}

	return typedTableQueryPage[T]{
		Rows:            pageRows,
		Continue:        continueToken,
		CursorInvalid:   cursorInvalid,
		Total:           total,
		UnfilteredTotal: len(items),
		TotalIsExact:    true,
		FacetsExact:     true,
		Namespaces:      typedTableFacetMapValues(namespaceFacets),
		Kinds:           typedTableFacetMapValues(kindFacets),
		FacetValues:     collectTypedTableFacetValues(items, adapter.Facets, true),
		Dynamic:         query.dynamicRef(),
		SortField:       query.Request.SortField,
	}
}

func (c typedTableQueryCursor) matches(query typedTableQuery) bool {
	// DynamicRevision is deliberately NOT compared. Metric-backed sorts
	// (cpu/memory) carry a metrics revision that advances every few seconds; the
	// cursor is a value-based keyset (LastValue holds the comparable sort value,
	// not an offset), so it keeps paging forward correctly across a metrics tick.
	// Invalidating on every revision change would reset a metric-sorted table to
	// page 1 constantly and make it impossible to page. See
	// TestTypedTableQueryContinuesCursorWhenDynamicRevisionChanges.
	return c.ClusterID == query.Request.ClusterID &&
		c.Table == query.Request.Table &&
		c.Signature == query.signature() &&
		c.SortField == query.Request.SortField &&
		c.SortDirection == query.Request.SortDirection &&
		c.Limit == query.Request.Limit
}

func (q typedTableQuery) signature() string {
	payload := struct {
		ClusterID     string                   `json:"clusterId"`
		Table         string                   `json:"table"`
		BaseScope     string                   `json:"baseScope"`
		Search        string                   `json:"search,omitempty"`
		Namespaces    []string                 `json:"namespaces,omitempty"`
		Kinds         []string                 `json:"kinds,omitempty"`
		Predicates    []ResourceQueryPredicate `json:"predicates,omitempty"`
		SortField     string                   `json:"sortField"`
		SortDirection string                   `json:"sortDirection"`
	}{
		ClusterID:     q.Request.ClusterID,
		Table:         q.Request.Table,
		BaseScope:     q.BaseScope,
		Search:        q.Request.Search,
		Namespaces:    q.Request.Namespaces,
		Kinds:         q.Request.Kinds,
		Predicates:    q.Request.Predicates,
		SortField:     q.Request.SortField,
		SortDirection: q.Request.SortDirection,
	}
	raw, _ := json.Marshal(payload)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func encodeTypedTableQueryCursor(cursor typedTableQueryCursor) string {
	raw, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeTypedTableQueryCursor(value string) (typedTableQueryCursor, bool) {
	// Trim like the unified cursor codec does, so a token padded in transport
	// decodes identically through both.
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		return typedTableQueryCursor{}, false
	}
	var cursor typedTableQueryCursor
	if err := json.Unmarshal(raw, &cursor); err != nil {
		return typedTableQueryCursor{}, false
	}
	return cursor, true
}
