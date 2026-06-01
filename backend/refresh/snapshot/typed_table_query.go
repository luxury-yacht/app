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
	Table           string
	ClusterID       string
	BaseScope       string
	Search          string
	Namespaces      []string
	Kinds           []string
	Predicates      map[string]string
	SortField       string
	SortDirection   string
	Limit           int
	Continue        string
	DynamicRevision string
}

type typedTableQueryPage[T any] struct {
	Rows         []T
	Continue     string
	Total        int
	TotalIsExact bool
	Namespaces   []string
	Kinds        []string
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
	query := typedTableQuery{
		Enabled:         found,
		Table:           table,
		ClusterID:       clusterID,
		BaseScope:       base,
		SortField:       "name",
		SortDirection:   "asc",
		Limit:           defaultTypedTableQueryLimit,
		DynamicRevision: dynamicRevision,
	}
	if !found {
		return base, query, nil
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return base, query, fmt.Errorf("%s query scope: %w", table, err)
	}
	query.Search = strings.TrimSpace(values.Get("search"))
	query.Namespaces = splitTypedTableList(values.Get("namespaces"))
	query.Kinds = splitTypedTableList(values.Get("kinds"))
	query.SortField = normalizeTypedTableSortField(values.Get("sort"), query.SortField)
	query.SortDirection = normalizeTypedTableSortDirection(values.Get("sortDirection"))
	query.Continue = strings.TrimSpace(values.Get("continue"))
	if limit, err := strconv.Atoi(strings.TrimSpace(values.Get("limit"))); err == nil && limit > 0 {
		query.Limit = min(limit, maxTypedTableQueryLimit)
	}
	query.Predicates = map[string]string{}
	for key, valuesForKey := range values {
		if !strings.HasPrefix(key, "predicate.") || len(valuesForKey) == 0 {
			continue
		}
		field := strings.TrimPrefix(key, "predicate.")
		if field == "" {
			continue
		}
		query.Predicates[field] = strings.TrimSpace(valuesForKey[0])
	}
	return base, query, nil
}

func splitTypedTableList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item == "" {
			continue
		}
		key := strings.ToLower(item)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, item)
	}
	sort.Strings(result)
	return result
}

func normalizeTypedTableSortField(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func normalizeTypedTableSortDirection(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "desc":
		return "desc"
	default:
		return "asc"
	}
}

func applyTypedTableQuery[T any](items []T, query typedTableQuery, adapter typedTableQueryAdapter[T]) typedTableQueryPage[T] {
	if !query.Enabled {
		return typedTableQueryPage[T]{
			Rows:         items,
			Total:        len(items),
			TotalIsExact: true,
			Namespaces:   collectTypedTableFacet(items, adapter.Namespace),
			Kinds:        collectTypedTableFacet(items, adapter.Kind),
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
	if query.Continue != "" {
		if cursor, ok := decodeTypedTableQueryCursor(query.Continue); ok && cursor.matches(query) {
			start = typedTableCursorStart(filtered, cursor, query, adapter)
		}
	}

	if start > len(filtered) {
		start = len(filtered)
	}
	end := min(start+query.Limit, len(filtered))
	pageRows := append([]T(nil), filtered[start:end]...)
	continueToken := ""
	if end < len(filtered) && len(pageRows) > 0 {
		last := pageRows[len(pageRows)-1]
		continueToken = encodeTypedTableQueryCursor(typedTableQueryCursor{
			ClusterID:       query.ClusterID,
			Table:           query.Table,
			Signature:       query.signature(),
			SortField:       query.SortField,
			SortDirection:   query.SortDirection,
			Limit:           query.Limit,
			LastValue:       typedTableComparableSortValue(last, query.SortField, adapter),
			LastKey:         adapter.Key(last),
			DynamicRevision: query.DynamicRevision,
		})
	}

	return typedTableQueryPage[T]{
		Rows:         pageRows,
		Continue:     continueToken,
		Total:        total,
		TotalIsExact: true,
		Namespaces:   collectTypedTableFacet(filtered, adapter.Namespace),
		Kinds:        collectTypedTableFacet(filtered, adapter.Kind),
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
}

func newTypedTableQueryCollector[T any](query typedTableQuery, adapter typedTableQueryAdapter[T]) *typedTableQueryCollector[T] {
	collector := &typedTableQueryCollector[T]{
		query:      query,
		adapter:    adapter,
		namespaces: make(map[string]string),
		kinds:      make(map[string]string),
	}
	if query.Continue != "" {
		if cursor, ok := decodeTypedTableQueryCursor(query.Continue); ok && cursor.matches(query) {
			collector.cursor = cursor
			collector.cursorValid = true
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
	maxCandidates := max(c.query.Limit+1, 1)
	if len(c.candidates) > maxCandidates {
		c.candidates = c.candidates[:maxCandidates]
	}
}

func (c *typedTableQueryCollector[T]) Page() typedTableQueryPage[T] {
	if c == nil {
		return typedTableQueryPage[T]{TotalIsExact: true}
	}
	sortTypedTableRows(c.candidates, c.query, c.adapter)
	end := min(c.query.Limit, len(c.candidates))
	pageRows := append([]T(nil), c.candidates[:end]...)
	continueToken := ""
	if len(c.candidates) > c.query.Limit && len(pageRows) > 0 {
		last := pageRows[len(pageRows)-1]
		continueToken = encodeTypedTableQueryCursor(typedTableQueryCursor{
			ClusterID:       c.query.ClusterID,
			Table:           c.query.Table,
			Signature:       c.query.signature(),
			SortField:       c.query.SortField,
			SortDirection:   c.query.SortDirection,
			Limit:           c.query.Limit,
			LastValue:       typedTableComparableSortValue(last, c.query.SortField, c.adapter),
			LastKey:         c.adapter.Key(last),
			DynamicRevision: c.query.DynamicRevision,
		})
	}
	return typedTableQueryPage[T]{
		Rows:         pageRows,
		Continue:     continueToken,
		Total:        c.total,
		TotalIsExact: true,
		Namespaces:   typedTableFacetMapValues(c.namespaces),
		Kinds:        typedTableFacetMapValues(c.kinds),
	}
}

func typedTableQueryMatches[T any](item T, query typedTableQuery, adapter typedTableQueryAdapter[T]) bool {
	namespaceSet := stringSet(query.Namespaces)
	kindSet := stringSet(query.Kinds)
	searchNeedle := strings.ToLower(strings.TrimSpace(query.Search))
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
	for field, value := range query.Predicates {
		if !adapter.Predicate(item, field, value) {
			return false
		}
	}
	return true
}

func typedTableItemAfterCursor[T any](item T, cursor typedTableQueryCursor, query typedTableQuery, adapter typedTableQueryAdapter[T]) bool {
	value := typedTableComparableSortValue(item, query.SortField, adapter)
	key := adapter.Key(item)
	if query.SortDirection == "desc" {
		return value < cursor.LastValue || (value == cursor.LastValue && key > cursor.LastKey)
	}
	return value > cursor.LastValue || (value == cursor.LastValue && key > cursor.LastKey)
}

func (c typedTableQueryCursor) matches(query typedTableQuery) bool {
	return c.ClusterID == query.ClusterID &&
		c.Table == query.Table &&
		c.Signature == query.signature() &&
		c.SortField == query.SortField &&
		c.SortDirection == query.SortDirection &&
		c.Limit == query.Limit
}

func (q typedTableQuery) signature() string {
	payload := struct {
		ClusterID     string            `json:"clusterId"`
		Table         string            `json:"table"`
		BaseScope     string            `json:"baseScope"`
		Search        string            `json:"search,omitempty"`
		Namespaces    []string          `json:"namespaces,omitempty"`
		Kinds         []string          `json:"kinds,omitempty"`
		Predicates    map[string]string `json:"predicates,omitempty"`
		SortField     string            `json:"sortField"`
		SortDirection string            `json:"sortDirection"`
	}{
		ClusterID:     q.ClusterID,
		Table:         q.Table,
		BaseScope:     q.BaseScope,
		Search:        q.Search,
		Namespaces:    q.Namespaces,
		Kinds:         q.Kinds,
		Predicates:    q.Predicates,
		SortField:     q.SortField,
		SortDirection: q.SortDirection,
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
		value := typedTableComparableSortValue(item, query.SortField, adapter)
		key := adapter.Key(item)
		if query.SortDirection == "desc" {
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
		leftNumeric, leftOK := adapter.NumericSort(items[i], query.SortField)
		rightNumeric, rightOK := adapter.NumericSort(items[j], query.SortField)
		if leftOK || rightOK {
			if !leftOK {
				leftNumeric = math.Inf(-1)
			}
			if !rightOK {
				rightNumeric = math.Inf(-1)
			}
			if leftNumeric != rightNumeric {
				if query.SortDirection == "desc" {
					return leftNumeric > rightNumeric
				}
				return leftNumeric < rightNumeric
			}
		} else {
			left := strings.ToLower(adapter.SortValue(items[i], query.SortField))
			right := strings.ToLower(adapter.SortValue(items[j], query.SortField))
			if left != right {
				if query.SortDirection == "desc" {
					return left > right
				}
				return left < right
			}
		}
		return adapter.Key(items[i]) < adapter.Key(items[j])
	})
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
