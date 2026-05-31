/*
 * backend/objectcatalog/query.go
 *
 * Catalog query filtering and matchers.
 */

package objectcatalog

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type kindMatcher func(kind, group, version, resource string) bool

type namespaceMatcher func(namespace string, scope Scope) bool

type searchMatcher func(name, namespace, kind string) bool

type customOnlyMatcher func(Summary) bool

const catalogQueryCursorVersion = 1
const (
	catalogQueryDefaultSort      = "kind/namespace/name"
	catalogQueryDefaultDirection = "asc"
	catalogQueryDirectionNext    = "next"
	catalogQueryDirectionPrev    = "prev"
)

var _ CatalogQueryStore = (*Service)(nil)

var catalogQueryExactMetadataThreshold = 100000

var catalogQueryBuiltinKeys = func() map[resourceIdentityKey]struct{} {
	keys := make(map[resourceIdentityKey]struct{}, len(builtinResourceCatalog))
	for _, desc := range builtinResourceCatalog {
		keys[identityKey(desc.Group, desc.Version, desc.Kind)] = struct{}{}
	}
	return keys
}()

type catalogQueryCursor struct {
	Version   int    `json:"v"`
	ClusterID string `json:"c"`
	Signature string `json:"q"`
	Sort      string `json:"s"`
	Direction string `json:"d"`
	Limit     int    `json:"l"`
	Kind      string `json:"kind"`
	Namespace string `json:"ns"`
	Name      string `json:"name"`
	Group     string `json:"g"`
	VersionID string `json:"gv"`
	Resource  string `json:"r"`
	UID       string `json:"uid"`
	Created   string `json:"ct,omitempty"`
}

// Query filters catalog entries and returns a paginated result.
func (s *Service) Query(opts QueryOptions) QueryResult {
	kindMatcher := newKindMatcher(opts.Kinds)
	namespaceMatcher := newNamespaceMatcher(opts.Namespaces)
	searchMatcher := newSearchMatcher(opts.Search)
	customMatcher := newCustomOnlyMatcher(opts.CustomOnly)
	hasNamespaceFilter := len(opts.Namespaces) > 0

	s.mu.RLock()
	cachedState := s.catalogIndex.cachedQueryState()
	s.mu.RUnlock()

	if len(cachedState.chunks) == 0 {
		return s.queryWithoutCache(opts, kindMatcher, namespaceMatcher, searchMatcher)
	}

	limit := clampQueryLimit(opts.Limit)

	matchKinds := make(map[string]bool)
	matchNamespaces := make(map[string]struct{})
	totalMatches := 0
	metadataExact := true
	namespaceKinds := cachedState.queryIndex.kindFacetsForNamespaces(opts.Namespaces)
	if hasNamespaceFilter && len(namespaceKinds) == 0 && !cachedState.queryIndex.hasIndex() {
		namespaceKinds = cachedState.kindFacetsForNamespaces(namespaceMatcher)
	}
	page, next, previous, cursorInvalid := s.pageCatalogChunks(
		cachedState,
		opts,
		limit,
		kindMatcher,
		namespaceMatcher,
		searchMatcher,
		customMatcher,
		func(item Summary) {
			if !customMatcher(item) {
				return
			}
			if !metadataExact {
				return
			}
			totalMatches++
			if totalMatches > catalogQueryExactMetadataThreshold {
				metadataExact = false
				return
			}
			if item.Kind != "" {
				matchKinds[item.Kind] = item.Scope == ScopeNamespace
			}
			matchNamespaces[item.Namespace] = struct{}{}
		},
	)

	resourceCount := countMatchingDescriptorsWithOptions(cachedState.descriptors, kindMatcher, opts)

	kinds := cachedState.kinds
	if opts.CustomOnly {
		kinds = snapshotSortedKindInfos(matchKinds)
	} else if hasNamespaceFilter {
		if len(namespaceKinds) > 0 {
			kinds = snapshotSortedKindInfos(namespaceKinds)
		} else {
			kinds = []KindInfo{}
		}
	} else if len(kinds) == 0 && len(matchKinds) > 0 {
		kinds = snapshotSortedKindInfos(matchKinds)
	}

	namespaces := cachedState.namespaces
	if len(namespaces) == 0 && len(matchNamespaces) > 0 {
		namespaces = snapshotSortedKeys(matchNamespaces)
	}

	return QueryResult{
		Items:         page,
		ContinueToken: next,
		PreviousToken: previous,
		CursorInvalid: cursorInvalid,
		TotalItems:    totalMatches,
		TotalIsExact:  metadataExact,
		ResourceCount: resourceCount,
		Kinds:         kinds,
		Namespaces:    namespaces,
		FacetsExact:   metadataExact,
	}
}

func (s *Service) pageCatalogChunks(
	cachedState catalogCachedQueryState,
	opts QueryOptions,
	limit int,
	kindMatcher kindMatcher,
	namespaceMatcher namespaceMatcher,
	searchMatcher searchMatcher,
	customMatcher customOnlyMatcher,
	onMatch func(Summary),
) ([]Summary, string, string, bool) {
	cursor, cursorValid, cursorInvalid := s.validateCatalogQueryCursor(opts, limit)
	direction := catalogQueryDirectionNext
	if cursorValid {
		direction = cursor.Direction
	}

	if cursorInvalid {
		cursorValid = false
	}

	if direction == catalogQueryDirectionPrev && cursorValid {
		return s.pageCatalogChunksPrevious(
			cachedState,
			opts,
			limit,
			cursor,
			kindMatcher,
			namespaceMatcher,
			searchMatcher,
			customMatcher,
			onMatch,
		)
	}

	page := make([]Summary, 0, limit)
	hasMore := false
	hasPrevious := false
	cachedState.forEachCatalogQueryCandidate(opts, func(item Summary) {
		if !customMatcher(item) || !matchesCatalogQuery(item, kindMatcher, namespaceMatcher, searchMatcher) {
			return
		}
		if onMatch != nil {
			onMatch(item)
		}
		if cursorValid && compareSummariesForCatalogQueryWithOptions(item, summaryFromCatalogCursor(cursor), opts) <= 0 {
			hasPrevious = true
			return
		}
		if insertCatalogQueryForwardPage(&page, item, limit, opts) {
			hasMore = true
		}
	})

	next := ""
	if hasMore && len(page) > 0 {
		next = encodeCatalogQueryCursor(s.catalogQueryCursorFor(opts, limit, catalogQueryDirectionNext, page[len(page)-1]))
	}
	previous := ""
	if hasPrevious && len(page) > 0 {
		previous = encodeCatalogQueryCursor(s.catalogQueryCursorFor(opts, limit, catalogQueryDirectionPrev, page[0]))
	}
	return page, next, previous, cursorInvalid
}

func (s *Service) pageCatalogChunksPrevious(
	cachedState catalogCachedQueryState,
	opts QueryOptions,
	limit int,
	cursor catalogQueryCursor,
	kindMatcher kindMatcher,
	namespaceMatcher namespaceMatcher,
	searchMatcher searchMatcher,
	customMatcher customOnlyMatcher,
	onMatch func(Summary),
) ([]Summary, string, string, bool) {
	anchor := summaryFromCatalogCursor(cursor)
	buffer := make([]Summary, 0, limit)
	beforeCount := 0
	cachedState.forEachCatalogQueryCandidate(opts, func(item Summary) {
		if !customMatcher(item) || !matchesCatalogQuery(item, kindMatcher, namespaceMatcher, searchMatcher) {
			return
		}
		if onMatch != nil {
			onMatch(item)
		}
		if compareSummariesForCatalogQueryWithOptions(item, anchor, opts) >= 0 {
			return
		}
		beforeCount++
		insertCatalogQueryPreviousPage(&buffer, item, limit, opts)
	})

	next := ""
	if len(buffer) > 0 {
		next = encodeCatalogQueryCursor(s.catalogQueryCursorFor(opts, limit, catalogQueryDirectionNext, buffer[len(buffer)-1]))
	}
	previous := ""
	if beforeCount > limit && len(buffer) > 0 {
		previous = encodeCatalogQueryCursor(s.catalogQueryCursorFor(opts, limit, catalogQueryDirectionPrev, buffer[0]))
	}
	return buffer, next, previous, false
}

func (state catalogCachedQueryState) forEachCatalogQueryCandidate(opts QueryOptions, visit func(Summary)) {
	if visit == nil {
		return
	}
	refs, ok := state.queryIndex.refsForQuery(opts)
	if ok {
		for _, ref := range refs {
			if ref.chunk < 0 || ref.chunk >= len(state.chunks) {
				continue
			}
			chunk := state.chunks[ref.chunk]
			if chunk == nil || ref.item < 0 || ref.item >= len(chunk.items) {
				continue
			}
			visit(chunk.items[ref.item])
		}
		return
	}
	for _, chunk := range state.chunks {
		if chunk == nil || len(chunk.items) == 0 {
			continue
		}
		for _, item := range chunk.items {
			visit(item)
		}
	}
}

func (idx catalogQueryIndex) refsForQuery(opts QueryOptions) ([]catalogIndexedSummaryRef, bool) {
	if !idx.hasIndex() {
		return nil, false
	}
	namespaceKeys := catalogQueryNamespaceFilterKeys(opts.Namespaces)
	kindKeys := catalogQueryKindFilterKeys(opts.Kinds)
	if len(namespaceKeys) == 0 && len(kindKeys) == 0 {
		return nil, false
	}
	refs := make([]catalogIndexedSummaryRef, 0)
	seen := make(map[catalogIndexedSummaryRef]struct{})
	appendRefs := func(candidates []catalogIndexedSummaryRef) {
		for _, ref := range candidates {
			if _, ok := seen[ref]; ok {
				continue
			}
			seen[ref] = struct{}{}
			refs = append(refs, ref)
		}
	}
	if len(namespaceKeys) > 0 && len(kindKeys) > 0 {
		for _, namespaceKey := range namespaceKeys {
			for _, kindKey := range kindKeys {
				appendRefs(idx.byNamespaceAndKind[catalogQueryCompoundIndexKey(namespaceKey, kindKey)])
			}
		}
		return refs, true
	}
	if len(namespaceKeys) > 0 {
		for _, namespaceKey := range namespaceKeys {
			appendRefs(idx.byNamespace[namespaceKey])
		}
		return refs, true
	}
	for _, kindKey := range kindKeys {
		appendRefs(idx.byKind[kindKey])
	}
	return refs, true
}

func (idx catalogQueryIndex) hasIndex() bool {
	return len(idx.byNamespace) > 0 || len(idx.byKind) > 0 || len(idx.byNamespaceAndKind) > 0
}

func (idx catalogQueryIndex) kindFacetsForNamespaces(namespaces []string) map[string]bool {
	namespaceKeys := catalogQueryNamespaceFilterKeys(namespaces)
	if len(namespaceKeys) == 0 {
		return nil
	}
	result := make(map[string]bool)
	for _, namespaceKey := range namespaceKeys {
		for kind, namespaced := range idx.kindsByNamespace[namespaceKey] {
			result[kind] = namespaced
		}
	}
	return result
}

func (state catalogCachedQueryState) kindFacetsForNamespaces(matcher namespaceMatcher) map[string]bool {
	result := make(map[string]bool)
	for _, chunk := range state.chunks {
		if chunk == nil {
			continue
		}
		for _, item := range chunk.items {
			if matcher(item.Namespace, item.Scope) && item.Kind != "" {
				result[item.Kind] = item.Scope == ScopeNamespace
			}
		}
	}
	return result
}

func (s *Service) queryWithoutCache(
	opts QueryOptions,
	kindMatcher kindMatcher,
	namespaceMatcher namespaceMatcher,
	searchMatcher searchMatcher,
) QueryResult {
	items := s.Snapshot()
	descriptors := s.Descriptors()
	customMatcher := newCustomOnlyMatcher(opts.CustomOnly)

	kindSet := make(map[string]bool)
	namespaceSet := make(map[string]struct{})
	// Scope the kinds list to namespace-filtered items when a namespace filter is active.
	namespaceKinds := make(map[string]bool)
	hasNamespaceFilter := len(opts.Namespaces) > 0
	for _, item := range items {
		if !customMatcher(item) {
			continue
		}
		if item.Kind != "" {
			kindSet[item.Kind] = item.Scope == ScopeNamespace
		}
		if item.Namespace != "" {
			namespaceSet[item.Namespace] = struct{}{}
		}
		if hasNamespaceFilter && namespaceMatcher(item.Namespace, item.Scope) {
			if item.Kind != "" {
				namespaceKinds[item.Kind] = item.Scope == ScopeNamespace
			}
		}
	}

	filtered := make([]Summary, 0, len(items))
	for _, item := range items {
		if !customMatcher(item) {
			continue
		}
		if !kindMatcher(item.Kind, item.Group, item.Version, item.Resource) {
			continue
		}
		if !namespaceMatcher(item.Namespace, item.Scope) {
			continue
		}
		if !searchMatcher(item.Name, item.Namespace, item.Kind) {
			continue
		}
		filtered = append(filtered, item)
	}

	sort.Slice(filtered, func(i, j int) bool {
		return compareSummariesForCatalogQueryWithOptions(filtered[i], filtered[j], opts) < 0
	})

	limit := clampQueryLimit(opts.Limit)
	page, next, previous, cursorInvalid := s.pageCatalogSummaries(filtered, opts, limit)
	total := len(filtered)

	resourceCount := countMatchingDescriptorsWithOptions(descriptors, kindMatcher, opts)

	kindSource := kindSet
	if hasNamespaceFilter {
		kindSource = namespaceKinds
	}
	kinds := snapshotSortedKindInfos(kindSource)

	namespaces := make([]string, 0, len(namespaceSet))
	for ns := range namespaceSet {
		namespaces = append(namespaces, ns)
	}
	sort.Strings(namespaces)

	return QueryResult{
		Items:         page,
		ContinueToken: next,
		PreviousToken: previous,
		CursorInvalid: cursorInvalid,
		TotalItems:    total,
		TotalIsExact:  true,
		ResourceCount: resourceCount,
		Kinds:         kinds,
		Namespaces:    namespaces,
		FacetsExact:   true,
	}
}

func (s *Service) pageCatalogSummaries(items []Summary, opts QueryOptions, limit int) ([]Summary, string, string, bool) {
	start := 0
	cursorInvalid := false
	if opts.Continue != "" {
		cursor, cursorValid, invalid := s.validateCatalogQueryCursor(opts, limit)
		cursorInvalid = invalid
		if cursorValid && cursor.Direction == catalogQueryDirectionPrev {
			end := firstSummaryAtOrAfterCursor(items, cursor, opts)
			start = end - limit
			if start < 0 {
				start = 0
			}
		} else if cursorValid {
			start = firstSummaryAfterCursor(items, cursor, opts)
		}
	}

	if start > len(items) {
		start = len(items)
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}

	page := make([]Summary, 0, limit)
	if start < len(items) {
		page = append(page, items[start:end]...)
	}

	next := ""
	if end < len(items) && len(page) > 0 {
		next = encodeCatalogQueryCursor(s.catalogQueryCursorFor(opts, limit, catalogQueryDirectionNext, page[len(page)-1]))
	}
	previous := ""
	if start > 0 && len(page) > 0 {
		previous = encodeCatalogQueryCursor(s.catalogQueryCursorFor(opts, limit, catalogQueryDirectionPrev, page[0]))
	}

	return page, next, previous, cursorInvalid
}

func (s *Service) validateCatalogQueryCursor(opts QueryOptions, limit int) (catalogQueryCursor, bool, bool) {
	if opts.Continue == "" {
		return catalogQueryCursor{}, false, false
	}
	cursor, ok := decodeCatalogQueryCursor(opts.Continue)
	if !ok ||
		cursor.Version != catalogQueryCursorVersion ||
		cursor.ClusterID != s.clusterID ||
		cursor.Signature != s.catalogQuerySignature(opts, limit) ||
		cursor.Sort != catalogQuerySortContract(opts) ||
		cursor.Limit != limit ||
		(cursor.Direction != catalogQueryDirectionNext && cursor.Direction != catalogQueryDirectionPrev) {
		return catalogQueryCursor{}, false, true
	}
	return cursor, true, false
}

func (s *Service) catalogQueryCursorFor(opts QueryOptions, limit int, direction string, item Summary) catalogQueryCursor {
	return catalogQueryCursor{
		Version:   catalogQueryCursorVersion,
		ClusterID: s.clusterID,
		Signature: s.catalogQuerySignature(opts, limit),
		Sort:      catalogQuerySortContract(opts),
		Direction: direction,
		Limit:     limit,
		Kind:      item.Kind,
		Namespace: item.Namespace,
		Name:      item.Name,
		Group:     item.Group,
		VersionID: item.Version,
		Resource:  item.Resource,
		UID:       item.UID,
		Created:   item.CreationTimestamp,
	}
}

func (s *Service) catalogQuerySignature(opts QueryOptions, limit int) string {
	kinds := normalizeQueryValues(opts.Kinds)
	namespaces := normalizeQueryValues(opts.Namespaces)
	return fmt.Sprintf(
		"limit=%d|search=%s|kinds=%s|namespaces=%s|customOnly=%t|sort=%s",
		limit,
		strings.TrimSpace(opts.Search),
		strings.Join(kinds, ","),
		strings.Join(namespaces, ","),
		opts.CustomOnly,
		catalogQuerySortContract(opts),
	)
}

func catalogQuerySortContract(opts QueryOptions) string {
	field := normalizeCatalogQuerySortField(opts.SortField)
	if field == "" {
		field = catalogQueryDefaultSort
	}
	return field + ":" + normalizeCatalogQuerySortDirection(opts.SortDirection)
}

func normalizeCatalogQuerySortField(field string) string {
	switch strings.ToLower(strings.TrimSpace(field)) {
	case "", catalogQueryDefaultSort:
		return catalogQueryDefaultSort
	case "kind", "namespace", "name", "age", "creationtimestamp", "creation-timestamp":
		return strings.ToLower(strings.TrimSpace(field))
	default:
		return catalogQueryDefaultSort
	}
}

func normalizeCatalogQuerySortDirection(direction string) string {
	switch strings.ToLower(strings.TrimSpace(direction)) {
	case "desc":
		return "desc"
	default:
		return catalogQueryDefaultDirection
	}
}

func normalizeQueryValues(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		normalized = append(normalized, strings.ToLower(trimmed))
	}
	sort.Strings(normalized)
	return normalized
}

func catalogQueryNamespaceFilterKeys(filters []string) []string {
	if len(filters) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(filters))
	result := make([]string, 0, len(filters))
	for _, filter := range filters {
		value := strings.TrimSpace(filter)
		key := strings.ToLower(value)
		if key == "" || key == "cluster" {
			key = "cluster"
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, key)
	}
	sort.Strings(result)
	return result
}

func catalogQueryKindFilterKeys(filters []string) []string {
	if len(filters) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(filters))
	result := make([]string, 0, len(filters))
	for _, filter := range filters {
		key := strings.ToLower(strings.TrimSpace(filter))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, key)
	}
	sort.Strings(result)
	return result
}

func catalogQueryKindIndexKeys(item Summary) []string {
	return catalogQueryKindCandidateKeys(item.Kind, item.Group, item.Version, item.Resource)
}

func catalogQueryKindCandidateKeys(kind, group, version, resource string) []string {
	candidates := []string{
		kind,
		group + "/" + kind,
		group + "/" + version + "/" + kind,
		resource,
		group + "/" + resource,
		group + "/" + version + "/" + resource,
	}
	seen := make(map[string]struct{}, len(candidates))
	result := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		key := strings.ToLower(strings.Trim(candidate, "/ "))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, key)
	}
	sort.Strings(result)
	return result
}

func encodeCatalogQueryCursor(cursor catalogQueryCursor) string {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeCatalogQueryCursor(token string) (catalogQueryCursor, bool) {
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil {
		return catalogQueryCursor{}, false
	}
	var cursor catalogQueryCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return catalogQueryCursor{}, false
	}
	return cursor, true
}

func summaryFromCatalogCursor(cursor catalogQueryCursor) Summary {
	return Summary{
		Kind:              cursor.Kind,
		Namespace:         cursor.Namespace,
		Name:              cursor.Name,
		Group:             cursor.Group,
		Version:           cursor.VersionID,
		Resource:          cursor.Resource,
		UID:               cursor.UID,
		CreationTimestamp: cursor.Created,
	}
}

func firstSummaryAfterCursor(items []Summary, cursor catalogQueryCursor, opts QueryOptions) int {
	anchor := summaryFromCatalogCursor(cursor)
	return sort.Search(len(items), func(i int) bool {
		return compareSummariesForCatalogQueryWithOptions(items[i], anchor, opts) > 0
	})
}

func firstSummaryAtOrAfterCursor(items []Summary, cursor catalogQueryCursor, opts QueryOptions) int {
	anchor := summaryFromCatalogCursor(cursor)
	return sort.Search(len(items), func(i int) bool {
		return compareSummariesForCatalogQueryWithOptions(items[i], anchor, opts) >= 0
	})
}

func matchesCatalogQuery(
	item Summary,
	kindMatcher kindMatcher,
	namespaceMatcher namespaceMatcher,
	searchMatcher searchMatcher,
) bool {
	return kindMatcher(item.Kind, item.Group, item.Version, item.Resource) &&
		namespaceMatcher(item.Namespace, item.Scope) &&
		searchMatcher(item.Name, item.Namespace, item.Kind)
}

func insertCatalogQueryForwardPage(page *[]Summary, item Summary, limit int, opts QueryOptions) bool {
	items := *page
	insertAt := sort.Search(len(items), func(i int) bool {
		return compareSummariesForCatalogQueryWithOptions(items[i], item, opts) >= 0
	})
	if insertAt >= limit {
		return true
	}
	items = append(items, Summary{})
	copy(items[insertAt+1:], items[insertAt:])
	items[insertAt] = item
	if len(items) > limit {
		items = items[:limit]
		returnedOverflow := true
		*page = items
		return returnedOverflow
	}
	*page = items
	return false
}

func insertCatalogQueryPreviousPage(page *[]Summary, item Summary, limit int, opts QueryOptions) {
	items := *page
	insertAt := sort.Search(len(items), func(i int) bool {
		return compareSummariesForCatalogQueryWithOptions(items[i], item, opts) >= 0
	})
	items = append(items, Summary{})
	copy(items[insertAt+1:], items[insertAt:])
	items[insertAt] = item
	if len(items) > limit {
		items = items[len(items)-limit:]
	}
	*page = items
}

func newKindMatcher(filters []string) kindMatcher {
	if len(filters) == 0 {
		return func(string, string, string, string) bool { return true }
	}
	normalized := make(map[string]struct{})
	for _, filter := range filters {
		value := strings.TrimSpace(filter)
		if value == "" {
			continue
		}
		normalized[strings.ToLower(value)] = struct{}{}
	}
	if len(normalized) == 0 {
		return func(string, string, string, string) bool { return true }
	}
	return func(kind, group, version, resource string) bool {
		for _, candidate := range catalogQueryKindCandidateKeys(kind, group, version, resource) {
			if _, ok := normalized[candidate]; ok {
				return true
			}
		}
		return false
	}
}

func newNamespaceMatcher(filters []string) namespaceMatcher {
	if len(filters) == 0 {
		return func(string, Scope) bool { return true }
	}

	namespaces := make(map[string]struct{})
	clusterRequested := false

	for _, filter := range filters {
		value := strings.TrimSpace(filter)
		if value == "" {
			clusterRequested = true
			continue
		}
		if strings.EqualFold(value, "cluster") {
			clusterRequested = true
			continue
		}
		namespaces[strings.ToLower(value)] = struct{}{}
	}

	if !clusterRequested && len(namespaces) == 0 {
		return func(string, Scope) bool { return true }
	}

	return func(namespace string, scope Scope) bool {
		if scope == ScopeCluster {
			return clusterRequested || len(namespaces) == 0
		}
		if len(namespaces) == 0 {
			// Only cluster-scoped objects were requested.
			return false
		}
		_, ok := namespaces[strings.ToLower(namespace)]
		return ok
	}
}

func newSearchMatcher(term string) searchMatcher {
	value := strings.ToLower(strings.TrimSpace(term))
	if value == "" {
		return func(string, string, string) bool { return true }
	}
	return func(name, namespace, kind string) bool {
		if strings.Contains(strings.ToLower(name), value) {
			return true
		}
		if namespace != "" && strings.Contains(strings.ToLower(namespace), value) {
			return true
		}
		if strings.Contains(strings.ToLower(kind), value) {
			return true
		}
		return false
	}
}

func newCustomOnlyMatcher(enabled bool) customOnlyMatcher {
	if !enabled {
		return func(Summary) bool { return true }
	}
	return func(item Summary) bool {
		_, builtin := catalogQueryBuiltinKeys[identityKey(item.Group, item.Version, item.Kind)]
		return !builtin
	}
}

func countMatchingDescriptorsWithOptions(descriptors []Descriptor, matcher kindMatcher, opts QueryOptions) int {
	if matcher == nil && !opts.CustomOnly {
		return len(descriptors)
	}
	count := 0
	for _, desc := range descriptors {
		if opts.CustomOnly {
			if _, builtin := catalogQueryBuiltinKeys[identityKey(desc.Group, desc.Version, desc.Kind)]; builtin {
				continue
			}
		}
		if matcher != nil && !matcher(desc.Kind, desc.Group, desc.Version, desc.Resource) {
			continue
		}
		count++
	}
	return count
}
