package snapshot

import (
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
)

const (
	defaultTypedTableQueryLimit = 250
	maxTypedTableQueryLimit     = 1000
)

type typedTableQuery struct {
	Enabled         bool
	BaseScope       string
	Request         ResourceQueryRequest
	DynamicRevision string
}

type typedTableQueryPage[T any] struct {
	Rows     []T
	Continue string
	// Previous is the backend prev-page cursor, populated on EVERY engine-served
	// response (F5) — the client keeps no token stack.
	Previous string
	// Self addresses the served page itself (counted serves only) — the token a
	// live refetch uses to stay page-stable after an anchored/offset landing.
	Self          string
	CursorInvalid bool
	// Anchor is present iff the request carried an anchor (jump-to-object).
	Anchor *ResourceQueryAnchorResult
	// PageStartRank is the 0-based rank of the page's first matching row; nil
	// when the serve did not pay the counted walk (plain cursor pages). Pointer
	// so rank 0 stays distinguishable from absent on the wire.
	PageStartRank *int
	Total         int
	// UnfilteredTotal is the count of items in scope before the query's filters
	// (search/kinds/namespaces/provider facets/predicates). It is the "of M" in the table's
	// "showing N of M items due to filters" banner; Total is the "N".
	UnfilteredTotal int
	TotalIsExact    bool
	Namespaces      []string
	Kinds           []string
	FacetValues     []ResourceQueryFacetValues
	FacetsExact     bool
	Dynamic         *ResourceQueryDynamicRef
	// SortField is the field the request asked to sort by; the envelope
	// validates it against the published sortable-fields capability so an
	// unsupported sort surfaces instead of silently falling back to name order.
	SortField string
}

type typedTableQueryAdapter[T any] struct {
	Key       func(T) string
	Namespace func(T) string
	Kind      func(T) string
	Facets    []typedTableQueryFacet[T]
	// AnchorKey builds the SAME row key as Key from an anchor's object identity
	// (kind, namespace, name) — the anchor→row resolution contract, pinned by
	// TestAdapterAnchorKeyMatchesKey. nil means the family cannot resolve
	// anchors (anchored requests report not-found).
	AnchorKey  func(kind, namespace, name string) string
	SearchText func(T) []string
	// MetadataText, when set, supplies extra searchable strings (e.g. labels and
	// annotations) that are matched only when the request sets IncludeMetadata.
	MetadataText func(T) []string
	Predicate    func(T, string, string) bool
	SortValue    func(T, string) string
	NumericSort  func(T, string) (float64, bool)
}

type typedTableQueryFacet[T any] struct {
	Descriptor ResourceQueryFacetDescriptor
	Value      func(T) string
	Values     func(T) []string
	Label      func(string) string
}

func typedTableFacetDescriptors[T any](facets []typedTableQueryFacet[T]) []ResourceQueryFacetDescriptor {
	descriptors := make([]ResourceQueryFacetDescriptor, 0, len(facets))
	for _, facet := range facets {
		descriptors = append(descriptors, facet.Descriptor)
	}
	return descriptors
}

func statusQueryFacet[T any](value func(T) string) typedTableQueryFacet[T] {
	return typedTableQueryFacet[T]{
		Descriptor: ResourceQueryFacetDescriptor{Key: "statuses", Label: "Status", Placeholder: "All statuses", BulkActions: true},
		Value:      value,
	}
}

func nodeQueryFacet[T any](value func(T) string) typedTableQueryFacet[T] {
	return typedTableQueryFacet[T]{
		Descriptor: ResourceQueryFacetDescriptor{Key: "nodes", Label: "Node", Placeholder: "All nodes", Searchable: true, BulkActions: true},
		Value:      value,
	}
}

func parseTypedTableQueryScope(clusterID, scope, table string, dynamicRevision string) (string, typedTableQuery, error) {
	base, rawQuery, found := strings.Cut(scope, "?")
	base = strings.TrimSpace(base)
	defaultRequest := ResourceQueryRequest{
		ClusterID:     clusterID,
		Table:         table,
		SortField:     "name",
		SortDirection: "asc",
		Limit:         defaultTypedTableQueryLimit,
	}
	query := typedTableQuery{
		Enabled:         found,
		BaseScope:       base,
		Request:         defaultRequest,
		DynamicRevision: dynamicRevision,
	}
	if !found {
		return base, query, nil
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return base, query, fmt.Errorf("%s query scope: %w", table, err)
	}
	query.Request = resourceQueryRequestFromValues(clusterID, table, values, defaultRequest)
	query.Request.SortField = normalizeTypedTableSortField(values.Get("sort"), query.Request.SortField)
	if query.Request.Limit > maxTypedTableQueryLimit {
		query.Request.Limit = maxTypedTableQueryLimit
	}
	if err := query.Request.validate(); err != nil {
		return base, query, fmt.Errorf("%s query scope: %w", table, err)
	}
	return base, query, nil
}

func normalizeTypedTableSortField(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

// typedQueryEnvelope assembles the canonical ResourceQueryEnvelope for the
// backend-query page path of a typed-resource table. Every typed domain builder
// uses this so the envelope wiring (provider, cursor, totals, facets,
// completeness, dynamic ref) lives in one place instead of being re-spelled per
// domain. It defaults to a complete, issue-free page; a partial/degraded build
// layers `withDegraded` on top.
func typedQueryEnvelope[T any](table string, page typedTableQueryPage[T], capabilities ResourceQueryCapabilities) ResourceQueryEnvelope {
	return ResourceQueryEnvelope{
		Provider:        ResourceQueryProviderTypedResource,
		Table:           table,
		Continue:        page.Continue,
		Previous:        page.Previous,
		Self:            page.Self,
		CursorInvalid:   page.CursorInvalid,
		Anchor:          page.Anchor,
		PageStartRank:   page.PageStartRank,
		Total:           page.Total,
		UnfilteredTotal: page.UnfilteredTotal,
		TotalIsExact:    page.TotalIsExact,
		Kinds:           page.Kinds,
		Namespaces:      page.Namespaces,
		FacetValues:     page.FacetValues,
		FacetsExact:     page.FacetsExact,
		Completeness:    resourceQueryCompleteness(true),
		Dynamic:         page.Dynamic,
		Capabilities:    capabilities,
		Issues:          unsupportedSortFieldIssues(page.SortField, capabilities),
	}
}

// unsupportedSortFieldIssues makes the published sortable-fields capability a
// real contract: a requested sort the table cannot honor falls back to name
// order in the adapters, which previously rendered under the requested column's
// lit arrow with no signal at all.
func unsupportedSortFieldIssues(sortField string, capabilities ResourceQueryCapabilities) []ResourceQueryIssue {
	field := strings.TrimSpace(sortField)
	if field == "" {
		return nil
	}
	for _, supported := range capabilities.SortableFields {
		if strings.EqualFold(field, supported) {
			return nil
		}
	}
	return []ResourceQueryIssue{{
		Kind:    "Sort",
		Message: fmt.Sprintf("%q is not a sortable field for this table; rows are ordered by name.", field),
	}}
}

// typedWindowEnvelope assembles the envelope for the non-query truncated-window
// path of a typed-resource table (no cursor or dynamic ref; facets describe the
// local window). `exact` is whether the window holds the complete matching set.
func typedWindowEnvelope(table string, total int, exact bool, kinds []string, facetValues []ResourceQueryFacetValues, capabilities ResourceQueryCapabilities) ResourceQueryEnvelope {
	facetsExact := true
	for _, facet := range facetValues {
		facetsExact = facetsExact && facet.Exact
	}
	return ResourceQueryEnvelope{
		Provider:        ResourceQueryProviderTypedResource,
		Table:           table,
		Total:           total,
		UnfilteredTotal: total,
		TotalIsExact:    exact,
		Kinds:           kinds,
		FacetValues:     facetValues,
		FacetsExact:     facetsExact,
		Completeness:    resourceQueryCompleteness(exact),
		Capabilities:    capabilities,
	}
}

// withDegraded downgrades an envelope when a build could not prove a complete,
// exact result (e.g. a partial namespace fanout). It folds the degraded signal
// into totals/facets exactness and completeness, and attaches reason-bearing
// issues, so a partial result can never present as a complete table.
func (e ResourceQueryEnvelope) withDegraded(exact bool, issues []ResourceQueryIssue) ResourceQueryEnvelope {
	e.TotalIsExact = e.TotalIsExact && exact
	e.FacetsExact = e.FacetsExact && exact
	for index := range e.FacetValues {
		e.FacetValues[index].Exact = e.FacetValues[index].Exact && exact
	}
	e.Completeness = resourceQueryCompleteness(exact)
	// Append: the envelope may already carry issues (e.g. an unsupported sort).
	e.Issues = append(e.Issues, issues...)
	return e
}

// withIssues attaches reason-bearing issues without itself touching exactness or
// completeness. The local-window path uses it after folding any unavailable
// source into the envelope's `exact` argument, so a window missing a
// permission-blocked source is reported as both inexact and issue-bearing.
func (e ResourceQueryEnvelope) withIssues(issues []ResourceQueryIssue) ResourceQueryEnvelope {
	// Append: the envelope may already carry issues (e.g. an unsupported sort).
	e.Issues = append(e.Issues, issues...)
	return e
}

// typedSnapshotPage is a resolved query-or-window result: the envelope, the
// rows to publish, and the snapshot stats. Builders assemble the final
// refresh.Snapshot around it (scope/version/payload struct stay builder-owned).
type typedSnapshotPage[T any] struct {
	Envelope ResourceQueryEnvelope
	Rows     []T
	Stats    refresh.SnapshotStats
}

// typedTableQueryMatcher prebuilds the per-query filter state (namespace/kind/
// provider-facet sets, search needle, predicate map) so matching N rows costs N membership
// checks, not N map constructions.
type typedTableQueryMatcher[T any] struct {
	adapter         typedTableQueryAdapter[T]
	includeMetadata bool
	namespaceSet    map[string]struct{}
	kindSet         map[string]struct{}
	facetSets       map[string]map[string]struct{}
	searchNeedle    string
	predicates      map[string]string
	matchNone       bool
}

func newTypedTableQueryMatcher[T any](query typedTableQuery, adapter typedTableQueryAdapter[T]) typedTableQueryMatcher[T] {
	return typedTableQueryMatcher[T]{
		adapter:         adapter,
		includeMetadata: query.Request.IncludeMetadata,
		namespaceSet:    stringSet(query.Request.Namespaces),
		kindSet:         stringSet(query.Request.Kinds),
		facetSets:       typedTableFacetSelectionSets(query.Request.Facets),
		searchNeedle:    strings.ToLower(strings.TrimSpace(query.Request.Search)),
		predicates:      resourceQueryPredicatesToMap(query.Request.Predicates),
		matchNone:       query.Request.MatchNone,
	}
}

func (m typedTableQueryMatcher[T]) Matches(item T) bool {
	if m.matchNone {
		return false
	}
	if len(m.namespaceSet) > 0 {
		if _, ok := m.namespaceSet[strings.ToLower(strings.TrimSpace(m.adapter.Namespace(item)))]; !ok {
			return false
		}
	}
	if len(m.kindSet) > 0 {
		if _, ok := m.kindSet[strings.ToLower(strings.TrimSpace(m.adapter.Kind(item)))]; !ok {
			return false
		}
	}
	for key, selected := range m.facetSets {
		facet, ok := typedTableFacetByKey(m.adapter.Facets, key)
		if !ok || (facet.Value == nil && facet.Values == nil) {
			return false
		}
		matched := false
		for _, value := range typedTableFacetItemValues(facet, item) {
			if _, exists := selected[strings.ToLower(strings.TrimSpace(value))]; exists {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if m.searchNeedle != "" {
		matched := typedTableSearchMatches(m.adapter.SearchText(item), m.searchNeedle)
		if !matched && m.includeMetadata && m.adapter.MetadataText != nil {
			matched = typedTableSearchMatches(m.adapter.MetadataText(item), m.searchNeedle)
		}
		if !matched {
			return false
		}
	}
	for field, value := range m.predicates {
		if !m.adapter.Predicate(item, field, value) {
			return false
		}
	}
	return true
}

func typedTableFacetItemValues[T any](facet typedTableQueryFacet[T], item T) []string {
	if facet.Values != nil {
		return facet.Values(item)
	}
	if facet.Value != nil {
		return []string{facet.Value(item)}
	}
	return nil
}

func typedTableFacetSelectionSets(selections map[string][]string) map[string]map[string]struct{} {
	if len(selections) == 0 {
		return nil
	}
	sets := make(map[string]map[string]struct{}, len(selections))
	for key, values := range selections {
		sets[key] = stringSet(values)
	}
	return sets
}

func typedTableFacetByKey[T any](facets []typedTableQueryFacet[T], key string) (typedTableQueryFacet[T], bool) {
	for _, facet := range facets {
		if facet.Descriptor.Key == key {
			return facet, true
		}
	}
	return typedTableQueryFacet[T]{}, false
}

func (q typedTableQuery) dynamicRef() *ResourceQueryDynamicRef {
	if strings.TrimSpace(q.DynamicRevision) == "" {
		return nil
	}
	return &ResourceQueryDynamicRef{
		Source:   "metrics",
		Revision: q.DynamicRevision,
		Policy:   "live-keyset",
	}
}

func typedTableComparableSortValue[T any](item T, field string, adapter typedTableQueryAdapter[T]) string {
	if numeric, ok := adapter.NumericSort(item, field); ok {
		return typedTableComparableNumericSortValue(numeric)
	}
	return strings.ToLower(adapter.SortValue(item, field))
}

func typedTableComparableNumericSortValue(numeric float64) string {
	// Normalize negative zero to positive zero so -0.0 and +0.0 encode to the
	// same key (their raw float bits differ in the sign bit otherwise).
	if numeric == 0 {
		numeric = 0
	}
	if math.IsNaN(numeric) {
		numeric = math.Inf(-1)
	}
	bits := math.Float64bits(numeric)
	if bits&(1<<63) != 0 {
		bits = ^bits
	} else {
		bits |= 1 << 63
	}
	return fmt.Sprintf("%016x", bits)
}

func typedTableSearchMatches(values []string, needle string) bool {
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), needle) {
			return true
		}
	}
	return false
}

func collectTypedTableFacet[T any](items []T, accessor func(T) string) []string {
	seen := map[string]string{}
	for _, item := range items {
		addTypedTableFacetValue(seen, accessor(item))
	}
	return typedTableFacetMapValues(seen)
}

func collectTypedTableFacetValues[T any](items []T, facets []typedTableQueryFacet[T], exact bool) []ResourceQueryFacetValues {
	values := make([]ResourceQueryFacetValues, 0, len(facets))
	for _, facet := range facets {
		seen := map[string]string{}
		for _, item := range items {
			for _, value := range typedTableFacetItemValues(facet, item) {
				addTypedTableFacetValue(seen, value)
			}
		}
		options := typedTableFacetMapValues(seen)
		projected := make([]ResourceQueryFacetOption, 0, len(options))
		for _, value := range options {
			label := value
			if facet.Label != nil {
				label = facet.Label(value)
			}
			projected = append(projected, ResourceQueryFacetOption{Value: value, Label: label})
		}
		values = append(values, ResourceQueryFacetValues{Key: facet.Descriptor.Key, Options: projected, Exact: exact})
	}
	return values
}

func addTypedTableFacetValue(seen map[string]string, raw string) {
	value := strings.TrimSpace(raw)
	if value == "" || value == "—" {
		return
	}
	key := strings.ToLower(value)
	if _, ok := seen[key]; !ok {
		seen[key] = value
	}
}

func typedTableFacetMapValues(seen map[string]string) []string {
	result := make([]string, 0, len(seen))
	for _, value := range seen {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func stringSet(values []string) map[string]struct{} {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[strings.ToLower(strings.TrimSpace(value))] = struct{}{}
	}
	return result
}

// parseFormattedCPUToMilli and parseFormattedMemoryToBytes are used for the
// always-numeric CPU/memory metric columns. A missing or unparseable value
// returns ok=true with a -Inf sentinel (sorts first ascending) rather than
// ok=false, so the field stays uniformly numeric and the page sort and keyset
// cursor cannot diverge on rows that lack a metric sample.
func parseFormattedCPUToMilli(value string) (float64, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "-" {
		return math.Inf(-1), true
	}
	if strings.HasSuffix(trimmed, "m") {
		parsed, err := strconv.ParseFloat(strings.TrimSuffix(trimmed, "m"), 64)
		if err != nil {
			return math.Inf(-1), true
		}
		return parsed, true
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return math.Inf(-1), true
	}
	return parsed * 1000, true
}

func parseFormattedMemoryToBytes(value string) (float64, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "-" {
		return math.Inf(-1), true
	}
	units := []struct {
		suffix string
		scale  float64
	}{
		{"Gi", 1024 * 1024 * 1024},
		{"GB", 1000 * 1000 * 1000},
		{"Mi", 1024 * 1024},
		{"MB", 1000 * 1000},
		{"Ki", 1024},
		{"KB", 1000},
	}
	for _, unit := range units {
		if strings.HasSuffix(trimmed, unit.suffix) {
			parsed, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(trimmed, unit.suffix)), 64)
			if err != nil {
				return math.Inf(-1), true
			}
			return parsed * unit.scale, true
		}
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return math.Inf(-1), true
	}
	return parsed, true
}
