package snapshot

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// configQuerypageSchema derives the querypage Schema for the config table from the
// existing typed-table adapter. It REUSES the adapter's exact comparable sort-value
// encoder (typedTableComparableSortValue) and row key (adapter.Key), so the
// querypage engine orders rows byte-identically to the live typed-table executor —
// the precondition for an invisible cutover. Facet extractors lower/trim to match
// the live matcher's namespace/kind set membership.
func configQuerypageSchema() querypage.Schema[ConfigSummary] {
	adapter := configTableQueryAdapter()
	sortFields := []string{"name", "kind", "namespace", "data", "age"}
	sortKeys := make(map[string]func(ConfigSummary) string, len(sortFields))
	for _, f := range sortFields {
		field := f
		sortKeys[field] = func(row ConfigSummary) string {
			return typedTableComparableSortValue(row, field, adapter)
		}
	}
	return querypage.Schema[ConfigSummary]{
		UID:      adapter.Key,
		SortKeys: sortKeys,
		Facets: map[string]func(ConfigSummary) string{
			"kind":      func(r ConfigSummary) string { return strings.ToLower(strings.TrimSpace(r.Kind)) },
			"namespace": func(r ConfigSummary) string { return strings.ToLower(strings.TrimSpace(r.Namespace)) },
		},
		// Join with NUL: the live search is "any SearchText element contains the
		// needle"; a NUL separator makes a single Contains equivalent because no real
		// needle contains NUL, so a match can never span the boundary.
		SearchText: func(row ConfigSummary) string {
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

// configQuerySignature pins a cursor to its query shape so a cursor issued for one
// filter/sort can never mispage a different one (it is rejected → CursorInvalid).
func configQuerySignature(sortField string, dir querypage.Direction, limit int, filters map[string][]string, search string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s|%s|%d|", sortField, dir, limit)
	for _, k := range []string{"kind", "namespace"} {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(strings.Join(filters[k], ","))
		b.WriteByte(';')
	}
	b.WriteString("search=")
	b.WriteString(strings.ToLower(strings.TrimSpace(search)))
	return b.String()
}

// applyConfigTableQueryViaStore answers a config table query through the querypage
// engine instead of the bespoke per-query sort. It produces the SAME
// typedTableQueryPage as applyTypedTableQuery: identical rows/order/pagination (the
// engine matches the live total order exactly), and identical facets/totals
// (computed by the same matcher + facet collector). The continue token is the
// engine's own opaque cursor — opaque to the frontend, which only round-trips it.
func applyConfigTableQueryViaStore(items []ConfigSummary, query typedTableQuery) typedTableQueryPage[ConfigSummary] {
	adapter := configTableQueryAdapter()
	if !query.Enabled {
		return applyTypedTableQuery(items, query, adapter)
	}

	schema := configQuerypageSchema()
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
	sig := configQuerySignature(sortField, dir, limit, filters, query.Request.Search)

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
	matched := make([]ConfigSummary, 0, len(items))
	for _, it := range items {
		if matcher.Matches(it) {
			matched = append(matched, it)
		}
	}

	return typedTableQueryPage[ConfigSummary]{
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

// resolveConfigSnapshotPageViaStore mirrors resolveTypedSnapshotPage for the config
// domain but serves the query branch through the querypage engine. The window
// branch and all envelope wiring are unchanged, so the snapshot payload is
// byte-identical apart from the opaque continue token.
func resolveConfigSnapshotPageViaStore(
	domain string,
	rows []ConfigSummary,
	query typedTableQuery,
	capabilities ResourceQueryCapabilities,
	windowLimit int,
	windowNoun string,
	kindOf func(ConfigSummary) string,
	issues []ResourceQueryIssue,
) typedSnapshotPage[ConfigSummary] {
	if query.Enabled {
		page := applyConfigTableQueryViaStore(rows, query)
		return typedSnapshotPage[ConfigSummary]{
			Envelope: typedQueryEnvelope(domain, page, capabilities).withDegraded(len(issues) == 0, issues),
			Rows:     page.Rows,
			Stats:    refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}
	}
	window, totalItems := truncateSnapshotWindow(rows, windowLimit)
	exact := totalItems == len(window) && len(issues) == 0
	return typedSnapshotPage[ConfigSummary]{
		Envelope: typedWindowEnvelope(domain, totalItems, exact, snapshotSortedKinds(window, kindOf), capabilities).withIssues(issues),
		Rows:     window,
		Stats:    snapshotWindowStats(len(window), totalItems, windowNoun),
	}
}
