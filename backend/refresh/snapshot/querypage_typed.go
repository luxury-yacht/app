package snapshot

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// querypageSchemaFromAdapter derives a querypage Schema for a typed table from its
// existing typed-table adapter. It REUSES the adapter's exact comparable sort-value
// encoder (typedTableComparableSortValue) and row key (adapter.Key), so the
// querypage engine orders rows byte-identically to the live typed-table executor —
// the precondition for an invisible cutover. Facet extractors lower/trim to match
// the live matcher's namespace/kind set membership.
func querypageSchemaFromAdapter[T any](adapter typedTableQueryAdapter[T], sortFields []string) querypage.Schema[T] {
	sortKeys := make(map[string]func(T) string, len(sortFields))
	for _, f := range sortFields {
		field := f
		sortKeys[field] = func(row T) string {
			return typedTableComparableSortValue(row, field, adapter)
		}
	}
	return querypage.Schema[T]{
		UID:      adapter.Key,
		SortKeys: sortKeys,
		Facets: map[string]func(T) string{
			"kind":      func(r T) string { return strings.ToLower(strings.TrimSpace(adapter.Kind(r))) },
			"namespace": func(r T) string { return strings.ToLower(strings.TrimSpace(adapter.Namespace(r))) },
		},
		// Join with NUL: the live search is "any SearchText element contains the
		// needle"; a NUL separator makes a single Contains equivalent because no real
		// needle contains NUL, so a match can never span the boundary.
		SearchText: func(row T) string {
			return strings.Join(adapter.SearchText(row), "\x00")
		},
	}
}

func lowerTrimAll(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if v := strings.ToLower(strings.TrimSpace(s)); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// typedQuerySignature pins a cursor to its query shape so a cursor issued for one
// filter/sort can never mispage a different one (it is rejected → CursorInvalid).
// It iterates the present filter keys in sorted order, so the signature is stable
// regardless of map iteration order and works for any typed table's facet set.
func typedQuerySignature(sortField string, dir querypage.Direction, limit int, filters map[string][]string, search string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s|%s|%d|", sortField, dir, limit)
	keys := make([]string, 0, len(filters))
	for k := range filters {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(strings.Join(filters[k], ","))
		b.WriteByte(';')
	}
	b.WriteString("search=")
	b.WriteString(strings.ToLower(strings.TrimSpace(search)))
	return b.String()
}

// applyTypedTableQueryViaStore answers a typed table query through the querypage
// engine instead of the bespoke per-query sort. It produces the SAME
// typedTableQueryPage as applyTypedTableQuery: identical rows/order/pagination (the
// engine matches the live total order exactly), and identical facets/totals
// (computed by the same matcher + facet collector). The continue token is the
// engine's own opaque cursor — opaque to the frontend, which only round-trips it.
func applyTypedTableQueryViaStore[T any](items []T, query typedTableQuery, adapter typedTableQueryAdapter[T], schema querypage.Schema[T]) typedTableQueryPage[T] {
	if !query.Enabled {
		return applyTypedTableQuery(items, query, adapter)
	}

	store := querypage.NewStore(schema)
	for _, it := range items {
		store.Upsert(it)
	}

	sortField := strings.ToLower(strings.TrimSpace(query.Request.SortField))
	if _, ok := schema.SortKeys[sortField]; !ok {
		sortField = "name"
	}
	dir := querypage.Ascending
	if strings.EqualFold(query.Request.SortDirection, "desc") {
		dir = querypage.Descending
	}
	limit := query.Request.Limit
	filters := map[string][]string{}
	if v := lowerTrimAll(query.Request.Namespaces); len(v) > 0 {
		filters["namespace"] = v
	}
	if v := lowerTrimAll(query.Request.Kinds); len(v) > 0 {
		filters["kind"] = v
	}
	sig := typedQuerySignature(sortField, dir, limit, filters, query.Request.Search)

	token := ""
	cursorInvalid := false
	if query.Request.Continue != "" {
		if cur, err := querypage.Decode(query.Request.Continue); err != nil ||
			cur.Validate(query.Request.ClusterID, sig, sortField, dir, limit) != nil {
			cursorInvalid = true
		} else {
			token = query.Request.Continue
		}
	}

	page, _ := store.Query(querypage.Query{
		ClusterID: query.Request.ClusterID,
		Signature: sig,
		Sort:      sortField,
		Direction: dir,
		Limit:     limit,
		Search:    query.Request.Search,
		Filters:   filters,
		Cursor:    token,
	})

	// Facets + totals match the live path exactly: same matcher, same collector.
	matcher := newTypedTableQueryMatcher(query, adapter)
	matched := make([]T, 0, len(items))
	for _, it := range items {
		if matcher.Matches(it) {
			matched = append(matched, it)
		}
	}

	return typedTableQueryPage[T]{
		Rows:            page.Rows,
		Continue:        page.NextCursor,
		CursorInvalid:   cursorInvalid,
		Total:           len(matched),
		UnfilteredTotal: len(items),
		TotalIsExact:    true,
		FacetsExact:     true,
		Namespaces:      collectTypedTableFacet(matched, adapter.Namespace),
		Kinds:           collectTypedTableFacet(matched, adapter.Kind),
		Dynamic:         query.dynamicRef(),
		SortField:       query.Request.SortField,
	}
}

// resolveTypedSnapshotPageViaStore mirrors resolveTypedSnapshotPage but serves the
// query branch through the querypage engine. The window branch and all envelope
// wiring are unchanged, so the snapshot payload is byte-identical apart from the
// opaque continue token.
func resolveTypedSnapshotPageViaStore[T any](
	domain string,
	rows []T,
	query typedTableQuery,
	adapter typedTableQueryAdapter[T],
	schema querypage.Schema[T],
	capabilities ResourceQueryCapabilities,
	windowLimit int,
	windowNoun string,
	kindOf func(T) string,
	issues []ResourceQueryIssue,
) typedSnapshotPage[T] {
	if query.Enabled {
		page := applyTypedTableQueryViaStore(rows, query, adapter, schema)
		return typedSnapshotPage[T]{
			Envelope: typedQueryEnvelope(domain, page, capabilities).withDegraded(len(issues) == 0, issues),
			Rows:     page.Rows,
			Stats:    refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}
	}
	window, totalItems := truncateSnapshotWindow(rows, windowLimit)
	exact := totalItems == len(window) && len(issues) == 0
	return typedSnapshotPage[T]{
		Envelope: typedWindowEnvelope(domain, totalItems, exact, snapshotSortedKinds(window, kindOf), capabilities).withIssues(issues),
		Rows:     window,
		Stats:    snapshotWindowStats(len(window), totalItems, windowNoun),
	}
}

// maintainedUnwrap resolves a possible cache.DeletedFinalStateUnknown tombstone to
// the underlying object so delete handlers can read its identity.
func maintainedUnwrap(obj interface{}) interface{} {
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		return tombstone.Obj
	}
	return obj
}

// typedMaintainedStore is a per-cluster, informer-fed view of a typed table's rows.
// A kind's event handlers project each object into a row of type T and
// Upsert/Delete it here, so the snapshot builder can serve rows straight from RAM
// (scope-filtered) instead of listing + re-projecting every request. It also tracks
// the max resourceVersion seen, for the snapshot's refetch identity.
//
// Correctness rests on the querypage engine's fuzz-proven incremental maintenance
// (store_property_test.go) and on registering the handlers before the informer
// factory starts, so the sync gate guarantees the store is populated before serve.
type typedMaintainedStore[T any] struct {
	store   *querypage.Store[T]
	meta    ClusterMeta
	adapter typedTableQueryAdapter[T]

	mu      sync.Mutex
	version uint64
}

func newTypedMaintainedStore[T any](meta ClusterMeta, schema querypage.Schema[T], adapter typedTableQueryAdapter[T]) *typedMaintainedStore[T] {
	return &typedMaintainedStore[T]{
		store:   querypage.NewStore(schema),
		meta:    meta,
		adapter: adapter,
	}
}

// ingest projects an added/updated object via the descriptor's StreamRow closure
// and upserts it — generic over the domain's kinds, no per-kind branch.
func (m *typedMaintainedStore[T]) ingest(d streamspec.Descriptor, obj interface{}) {
	item, ok := maintainedUnwrap(obj).(metav1.Object)
	if !ok {
		return
	}
	row, ok := d.StreamRow(m.meta, item).(T)
	if !ok {
		return
	}
	m.store.Upsert(row)
	m.bumpVersion(item)
}

// evict removes a deleted object by its row key (kind/namespace/name).
func (m *typedMaintainedStore[T]) evict(d streamspec.Descriptor, obj interface{}) {
	item, ok := maintainedUnwrap(obj).(metav1.Object)
	if !ok {
		return
	}
	m.store.Delete(namespacedTableKey(d.Kind, item.GetNamespace(), item.GetName()))
}

func (m *typedMaintainedStore[T]) bumpVersion(o metav1.Object) {
	v := resourceVersionOrTimestamp(o)
	if v == 0 {
		return
	}
	m.mu.Lock()
	if v > m.version {
		m.version = v
	}
	m.mu.Unlock()
}

func (m *typedMaintainedStore[T]) snapshotVersion() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.version
}

// rows returns the maintained rows for a namespace ("" = all namespaces), restricted
// to the kinds available for THIS request — mirroring the list path's per-request
// runtimeResourceAllowed gating so the two produce the same set.
func (m *typedMaintainedStore[T]) rows(namespace string, availableKinds map[string]bool) []T {
	all := m.store.Snapshot()
	out := make([]T, 0, len(all))
	for _, row := range all {
		if !availableKinds[m.adapter.Kind(row)] {
			continue
		}
		if namespace != "" && m.adapter.Namespace(row) != namespace {
			continue
		}
		out = append(out, row)
	}
	return out
}
