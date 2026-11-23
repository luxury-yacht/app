/*
 * backend/objectcatalog/query.go
 *
 * Catalog query entry point, sort/filter normalization, and the row matchers shared
 * with the querypage engine serve (query_engine.go). The bespoke chunk-scan executor
 * and cursor codec were removed once Service.Query was cut over to the engine; this
 * file now holds only the request normalization and matcher helpers the engine maps a
 * QueryOptions onto.
 */

package objectcatalog

import (
	"slices"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcekind"
)

type kindMatcher func(kind, group, version, resource string) bool

type namespaceMatcher func(namespace string, scope Scope) bool

type searchMatcher func(name, namespace, kind string) bool

type customOnlyMatcher func(Summary) bool

const (
	catalogQueryDefaultSort      = "kind/namespace/name"
	catalogQueryDefaultDirection = "asc"
)

// QuerySortRelevance orders a search's matches best first (see catalogSearchRank)
// before the limit applies; without a search it is the default order. It serves
// one page: the request boundary rejects paging it (continue, startRank, anchor).
// Used by the command palette.
const QuerySortRelevance = "relevance"

var catalogQueryExactMetadataThreshold = 100000

// Query filters catalog entries and returns a paginated result. It serves through the
// querypage engine (queryViaEngine via the Querier); the engine path always
// returns a result, so there is no legacy fallback.
func (s *Service) Query(opts QueryOptions) QueryResult {
	if s.queryStore != nil {
		if result, ok := s.queryStore.QueryCatalog(opts); ok {
			return result
		}
	}
	// The default in-memory store always serves a result; this only runs if an
	// alternative Querier declined the query.
	result, _ := s.queryViaEngine(opts)
	return result
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
	case QuerySortRelevance, "kind", "namespace", "name", "api", "age", "creationtimestamp", "creation-timestamp":
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

func matchesCatalogQuery(
	item Summary,
	kindMatcher kindMatcher,
	namespaceMatcher namespaceMatcher,
	searchMatcher searchMatcher,
) bool {
	return kindMatcher(item.Ref.Kind, item.Ref.Group, item.Ref.Version, item.Ref.Resource) &&
		namespaceMatcher(item.Ref.Namespace, item.Scope) &&
		searchMatcher(item.Ref.Name, item.Ref.Namespace, item.Ref.Kind)
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

// catalogSearchRank ranks a search match for the relevance order from the row's
// lowercased search text (name, namespace, and kind joined by
// catalogEngineFieldSep; see the schema's SearchText). Each word scores where it
// matches best — exact name, then a name starting with it, a name containing it,
// an exact namespace, a namespace containing it, and only the kind — and the
// word scores add up.
func catalogSearchRank(search string) func(searchText string) int {
	words := strings.Fields(strings.ToLower(search))
	return func(searchText string) int {
		// Cut returns substrings of searchText, so ranking a row allocates nothing.
		name, rest, _ := strings.Cut(searchText, catalogEngineFieldSep)
		namespace, kind, _ := strings.Cut(rest, catalogEngineFieldSep)
		rank := 0
		for _, word := range words {
			rank += catalogWordRank(word, name, namespace, kind)
		}
		return rank
	}
}

func catalogWordRank(word, name, namespace, kind string) int {
	switch {
	case name == word:
		return 6
	case strings.HasPrefix(name, word):
		return 5
	case strings.Contains(name, word):
		return 4
	case namespace == word:
		return 3
	case strings.Contains(namespace, word):
		return 2
	case strings.Contains(kind, word):
		return 1
	default:
		return 0
	}
}

// newSearchMatcher matches an object when every word of term appears in its name,
// namespace or kind (case-insensitive). An empty term matches every object.
func newSearchMatcher(term string) searchMatcher {
	words := strings.Fields(strings.ToLower(term))
	if len(words) == 0 {
		return func(string, string, string) bool { return true }
	}
	return func(name, namespace, kind string) bool {
		fields := []string{strings.ToLower(name), strings.ToLower(namespace), strings.ToLower(kind)}
		for _, word := range words {
			if !slices.ContainsFunc(fields, func(field string) bool { return strings.Contains(field, word) }) {
				return false
			}
		}
		return true
	}
}

func newCustomOnlyMatcher(opts QueryOptions) customOnlyMatcher {
	if !opts.CustomOnly {
		return func(Summary) bool { return true }
	}
	inScope := newNamespaceMatcher(opts.ScopeNamespaces)
	return func(item Summary) bool {
		_, custom := opts.customResources[catalogSummaryResourceIdentity(item)]
		return custom && (opts.Scope == "" || item.Scope == opts.Scope) && inScope(item.Ref.Namespace, item.Scope)
	}
}

func countMatchingDescriptorsWithOptions(descriptors []Descriptor, matcher kindMatcher, opts QueryOptions) int {
	if matcher == nil && opts.ResourceFamily == "" && !opts.CustomOnly && len(opts.Groups) == 0 && len(opts.ResourceScopes) == 0 {
		return len(descriptors)
	}
	descriptorMatcher := newDescriptorQueryMatcher(matcher, opts)
	count := 0
	for _, desc := range descriptors {
		if descriptorMatcher.matches(desc) {
			count++
		}
	}
	return count
}

type descriptorQueryMatcher struct {
	resourceFamily  string
	kindMatcher     kindMatcher
	customResources map[string]struct{}
	customOnly      bool
	customScope     Scope
	filterGroups    bool
	filterScopes    bool
	groups          map[string]struct{}
	resourceScopes  map[string]struct{}
}

func newDescriptorQueryMatcher(matcher kindMatcher, opts QueryOptions) descriptorQueryMatcher {
	result := descriptorQueryMatcher{
		resourceFamily:  opts.ResourceFamily,
		kindMatcher:     matcher,
		customOnly:      opts.CustomOnly,
		customResources: opts.customResources,
		customScope:     opts.Scope,
		filterGroups:    len(opts.Groups) > 0, filterScopes: len(opts.ResourceScopes) > 0,
		groups: make(map[string]struct{}, len(opts.Groups)), resourceScopes: make(map[string]struct{}, len(opts.ResourceScopes)),
	}
	for _, group := range normalizeCatalogAPIGroups(opts.Groups) {
		result.groups[group] = struct{}{}
	}
	for _, scope := range normalizeCatalogResourceScopes(opts.ResourceScopes) {
		result.resourceScopes[scope] = struct{}{}
	}
	return result
}

func (m descriptorQueryMatcher) matches(desc Descriptor) bool {
	if m.resourceFamily != "" && resourcekind.FamilyForResource(desc.Group, desc.Kind, desc.Namespaced) != m.resourceFamily {
		return false
	}
	if m.customOnly && !m.matchesCustomResource(desc) {
		return false
	}
	if m.kindMatcher != nil && !m.kindMatcher(desc.Kind, desc.Group, desc.Version, desc.Resource) {
		return false
	}
	if m.filterGroups && !stringSetContains(m.groups, catalogAPIGroupFacetValue(desc.Group)) {
		return false
	}
	return !m.filterScopes || stringSetContains(m.resourceScopes, strings.ToLower(string(desc.Scope)))
}

func (m descriptorQueryMatcher) matchesCustomResource(desc Descriptor) bool {
	_, custom := m.customResources[catalogResourceIdentity(desc.Group, desc.Version, desc.Resource, desc.Kind, desc.Scope)]
	return custom && (m.customScope == "" || m.customScope == desc.Scope)
}

func stringSetContains(values map[string]struct{}, value string) bool {
	_, ok := values[value]
	return ok
}
