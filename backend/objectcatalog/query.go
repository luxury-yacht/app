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
	"sort"
	"strings"
)

type kindMatcher func(kind, group, version, resource string) bool

type namespaceMatcher func(namespace string, scope Scope) bool

type searchMatcher func(name, namespace, kind string) bool

type customOnlyMatcher func(Summary) bool

const (
	catalogQueryDefaultSort      = "kind/namespace/name"
	catalogQueryDefaultDirection = "asc"
)

var catalogQueryExactMetadataThreshold = 100000

var catalogQueryBuiltinKeys = func() map[resourceIdentityKey]struct{} {
	keys := make(map[resourceIdentityKey]struct{}, len(builtinResourceCatalog))
	for _, desc := range builtinResourceCatalog {
		keys[identityKey(desc.Group, desc.Version, desc.Kind)] = struct{}{}
	}
	return keys
}()

// Query filters catalog entries and returns a paginated result. It serves through the
// querypage engine (queryViaEngine via the CatalogQueryStore); the engine path always
// returns a result, so there is no legacy fallback.
func (s *Service) Query(opts QueryOptions) QueryResult {
	if s.queryStore != nil {
		if result, ok := s.queryStore.QueryCatalog(opts); ok {
			return result
		}
	}
	// The default in-memory store always serves a result; this only runs if an
	// alternative CatalogQueryStore declined the query.
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
	return kindMatcher(item.Kind, item.Group, item.Version, item.Resource) &&
		namespaceMatcher(item.Namespace, item.Scope) &&
		searchMatcher(item.Name, item.Namespace, item.Kind)
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
