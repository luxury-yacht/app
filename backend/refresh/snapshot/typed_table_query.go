package snapshot

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
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
	Rows          []T
	Continue      string
	Previous      string
	CursorInvalid bool
	Total         int
	TotalIsExact  bool
	Namespaces    []string
	Kinds         []string
	FacetsExact   bool
	Dynamic       *ResourceQueryDynamicRef
}

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

type typedTableQueryAdapter[T any] struct {
	Key         func(T) string
	Namespace   func(T) string
	Kind        func(T) string
	SearchText  func(T) []string
	Predicate   func(T, string, string) bool
	SortValue   func(T, string) string
	NumericSort func(T, string) (float64, bool)
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
	return base, query, nil
}

func normalizeTypedTableSortField(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func applyTypedTableQuery[T any](items []T, query typedTableQuery, adapter typedTableQueryAdapter[T]) typedTableQueryPage[T] {
	if !query.Enabled {
		return typedTableQueryPage[T]{
			Rows:         items,
			Total:        len(items),
			TotalIsExact: true,
			FacetsExact:  true,
			Namespaces:   collectTypedTableFacet(items, adapter.Namespace),
			Kinds:        collectTypedTableFacet(items, adapter.Kind),
			Dynamic:      query.dynamicRef(),
		}
	}

	filtered := make([]T, 0, len(items))
	for _, item := range items {
		if !typedTableQueryMatches(item, query, adapter) {
			continue
		}
		filtered = append(filtered, item)
	}

	sortTypedTableRows(filtered, query, adapter)
	total := len(filtered)

	start := 0
	cursorInvalid := false
	if query.Request.Continue != "" {
		if cursor, ok := decodeTypedTableQueryCursor(query.Request.Continue); ok && cursor.matches(query) {
			start = typedTableCursorStart(filtered, cursor, query, adapter)
		} else {
			cursorInvalid = true
		}
	}

	if start > len(filtered) {
		start = len(filtered)
	}
	end := min(start+query.Request.Limit, len(filtered))
	pageRows := append([]T(nil), filtered[start:end]...)
	continueToken := ""
	if end < len(filtered) && len(pageRows) > 0 {
		last := pageRows[len(pageRows)-1]
		continueToken = encodeTypedTableQueryCursor(typedTableQueryCursor{
			ClusterID:       query.Request.ClusterID,
			Table:           query.Request.Table,
			Signature:       query.signature(),
			SortField:       query.Request.SortField,
			SortDirection:   query.Request.SortDirection,
			Limit:           query.Request.Limit,
			LastValue:       typedTableComparableSortValue(last, query.Request.SortField, adapter),
			LastKey:         adapter.Key(last),
			DynamicRevision: query.DynamicRevision,
		})
	}

	return typedTableQueryPage[T]{
		Rows:          pageRows,
		Continue:      continueToken,
		CursorInvalid: cursorInvalid,
		Total:         total,
		TotalIsExact:  true,
		FacetsExact:   true,
		Namespaces:    collectTypedTableFacet(filtered, adapter.Namespace),
		Kinds:         collectTypedTableFacet(filtered, adapter.Kind),
		Dynamic:       query.dynamicRef(),
	}
}

type typedTableQueryCollector[T any] struct {
	query       typedTableQuery
	adapter     typedTableQueryAdapter[T]
	cursor      typedTableQueryCursor
	cursorValid bool
	total       int
	namespaces  map[string]string
	kinds       map[string]string
	candidates  []T
	invalid     bool
}

func newTypedTableQueryCollector[T any](query typedTableQuery, adapter typedTableQueryAdapter[T]) *typedTableQueryCollector[T] {
	collector := &typedTableQueryCollector[T]{
		query:      query,
		adapter:    adapter,
		namespaces: make(map[string]string),
		kinds:      make(map[string]string),
	}
	if query.Request.Continue != "" {
		if cursor, ok := decodeTypedTableQueryCursor(query.Request.Continue); ok && cursor.matches(query) {
			collector.cursor = cursor
			collector.cursorValid = true
		} else {
			collector.invalid = true
		}
	}
	return collector
}

func (c *typedTableQueryCollector[T]) Add(item T) {
	if c == nil {
		return
	}
	if !typedTableQueryMatches(item, c.query, c.adapter) {
		return
	}
	c.total++
	addTypedTableFacetValue(c.namespaces, c.adapter.Namespace(item))
	addTypedTableFacetValue(c.kinds, c.adapter.Kind(item))
	if c.cursorValid && !typedTableItemAfterCursor(item, c.cursor, c.query, c.adapter) {
		return
	}
	c.candidates = append(c.candidates, item)
	sortTypedTableRows(c.candidates, c.query, c.adapter)
	maxCandidates := max(c.query.Request.Limit+1, 1)
	if len(c.candidates) > maxCandidates {
		c.candidates = c.candidates[:maxCandidates]
	}
}

func (c *typedTableQueryCollector[T]) Page() typedTableQueryPage[T] {
	if c == nil {
		return typedTableQueryPage[T]{TotalIsExact: true, FacetsExact: true}
	}
	sortTypedTableRows(c.candidates, c.query, c.adapter)
	end := min(c.query.Request.Limit, len(c.candidates))
	pageRows := append([]T(nil), c.candidates[:end]...)
	continueToken := ""
	if len(c.candidates) > c.query.Request.Limit && len(pageRows) > 0 {
		last := pageRows[len(pageRows)-1]
		continueToken = encodeTypedTableQueryCursor(typedTableQueryCursor{
			ClusterID:       c.query.Request.ClusterID,
			Table:           c.query.Request.Table,
			Signature:       c.query.signature(),
			SortField:       c.query.Request.SortField,
			SortDirection:   c.query.Request.SortDirection,
			Limit:           c.query.Request.Limit,
			LastValue:       typedTableComparableSortValue(last, c.query.Request.SortField, c.adapter),
			LastKey:         c.adapter.Key(last),
			DynamicRevision: c.query.DynamicRevision,
		})
	}
	return typedTableQueryPage[T]{
		Rows:          pageRows,
		Continue:      continueToken,
		CursorInvalid: c.invalid,
		Total:         c.total,
		TotalIsExact:  true,
		FacetsExact:   true,
		Namespaces:    typedTableFacetMapValues(c.namespaces),
		Kinds:         typedTableFacetMapValues(c.kinds),
		Dynamic:       c.query.dynamicRef(),
	}
}

func typedTableQueryMatches[T any](item T, query typedTableQuery, adapter typedTableQueryAdapter[T]) bool {
	namespaceSet := stringSet(query.Request.Namespaces)
	kindSet := stringSet(query.Request.Kinds)
	searchNeedle := strings.ToLower(strings.TrimSpace(query.Request.Search))
	if len(namespaceSet) > 0 {
		if _, ok := namespaceSet[strings.ToLower(strings.TrimSpace(adapter.Namespace(item)))]; !ok {
			return false
		}
	}
	if len(kindSet) > 0 {
		if _, ok := kindSet[strings.ToLower(strings.TrimSpace(adapter.Kind(item)))]; !ok {
			return false
		}
	}
	if searchNeedle != "" && !typedTableSearchMatches(adapter.SearchText(item), searchNeedle) {
		return false
	}
	for field, value := range resourceQueryPredicatesToMap(query.Request.Predicates) {
		if !adapter.Predicate(item, field, value) {
			return false
		}
	}
	return true
}

func typedTableItemAfterCursor[T any](item T, cursor typedTableQueryCursor, query typedTableQuery, adapter typedTableQueryAdapter[T]) bool {
	value := typedTableComparableSortValue(item, query.Request.SortField, adapter)
	key := adapter.Key(item)
	if query.Request.SortDirection == "desc" {
		return value < cursor.LastValue || (value == cursor.LastValue && key > cursor.LastKey)
	}
	return value > cursor.LastValue || (value == cursor.LastValue && key > cursor.LastKey)
}

func (c typedTableQueryCursor) matches(query typedTableQuery) bool {
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
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return typedTableQueryCursor{}, false
	}
	var cursor typedTableQueryCursor
	if err := json.Unmarshal(raw, &cursor); err != nil {
		return typedTableQueryCursor{}, false
	}
	return cursor, true
}

func typedTableCursorStart[T any](items []T, cursor typedTableQueryCursor, query typedTableQuery, adapter typedTableQueryAdapter[T]) int {
	for i, item := range items {
		value := typedTableComparableSortValue(item, query.Request.SortField, adapter)
		key := adapter.Key(item)
		if query.Request.SortDirection == "desc" {
			if value < cursor.LastValue || (value == cursor.LastValue && key > cursor.LastKey) {
				return i
			}
			continue
		}
		if value > cursor.LastValue || (value == cursor.LastValue && key > cursor.LastKey) {
			return i
		}
	}
	return len(items)
}

func sortTypedTableRows[T any](items []T, query typedTableQuery, adapter typedTableQueryAdapter[T]) {
	sort.SliceStable(items, func(i, j int) bool {
		leftNumeric, leftOK := adapter.NumericSort(items[i], query.Request.SortField)
		rightNumeric, rightOK := adapter.NumericSort(items[j], query.Request.SortField)
		if leftOK || rightOK {
			if !leftOK {
				leftNumeric = math.Inf(-1)
			}
			if !rightOK {
				rightNumeric = math.Inf(-1)
			}
			if leftNumeric != rightNumeric {
				if query.Request.SortDirection == "desc" {
					return leftNumeric > rightNumeric
				}
				return leftNumeric < rightNumeric
			}
		} else {
			left := strings.ToLower(adapter.SortValue(items[i], query.Request.SortField))
			right := strings.ToLower(adapter.SortValue(items[j], query.Request.SortField))
			if left != right {
				if query.Request.SortDirection == "desc" {
					return left > right
				}
				return left < right
			}
		}
		return adapter.Key(items[i]) < adapter.Key(items[j])
	})
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
		return fmt.Sprintf("%020.6f", numeric)
	}
	return strings.ToLower(adapter.SortValue(item, field))
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

func parseFormattedCPUToMilli(value string) (float64, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "-" {
		return 0, false
	}
	if strings.HasSuffix(trimmed, "m") {
		parsed, err := strconv.ParseFloat(strings.TrimSuffix(trimmed, "m"), 64)
		return parsed, err == nil
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	return parsed * 1000, err == nil
}

func parseFormattedMemoryToBytes(value string) (float64, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "-" {
		return 0, false
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
			return parsed * unit.scale, err == nil
		}
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	return parsed, err == nil
}
