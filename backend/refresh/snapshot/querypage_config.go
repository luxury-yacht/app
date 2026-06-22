package snapshot

import (
	"strings"

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
