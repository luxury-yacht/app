/*
 * backend/objectcatalog/query.go
 *
 * Catalog query filtering and matchers.
 */

package objectcatalog

import (
	"sort"
	"strconv"
	"strings"
)

type kindMatcher func(kind, group, version, resource string) bool

type namespaceMatcher func(namespace string, scope Scope) bool

type searchMatcher func(name, namespace, kind string) bool

// Query filters catalog entries and returns a paginated result.
func (s *Service) Query(opts QueryOptions) QueryResult {
	kindMatcher := newKindMatcher(opts.Kinds)
	namespaceMatcher := newNamespaceMatcher(opts.Namespaces)
	searchMatcher := newSearchMatcher(opts.Search)
	hasNamespaceFilter := len(opts.Namespaces) > 0

	s.mu.RLock()
	chunks := make([]*summaryChunk, len(s.sortedChunks))
	copy(chunks, s.sortedChunks)
	cachedKinds := append([]string(nil), s.cachedKinds...)
	cachedNamespaces := append([]string(nil), s.cachedNamespaces...)
	cachedDescriptors := append([]Descriptor(nil), s.cachedDescriptors...)
	s.mu.RUnlock()

	if len(chunks) == 0 {
		return s.queryWithoutCache(opts, kindMatcher, namespaceMatcher, searchMatcher)
	}

	limit := clampQueryLimit(opts.Limit)
	start := 0
	if opts.Continue != "" {
		if parsed, err := strconv.Atoi(opts.Continue); err == nil && parsed >= 0 {
			start = parsed
		}
	}

	matches := make([]Summary, 0)
	matchKinds := make(map[string]struct{})
	matchNamespaces := make(map[string]struct{})
	// Scope the kinds list to namespace-filtered items when a namespace filter is active.
	namespaceKinds := make(map[string]struct{})
	totalMatches := 0

	for _, chunk := range chunks {
		if chunk == nil || len(chunk.items) == 0 {
			continue
		}
		for _, item := range chunk.items {
			if hasNamespaceFilter && namespaceMatcher(item.Namespace, item.Scope) {
				if item.Kind != "" {
					namespaceKinds[item.Kind] = struct{}{}
				}
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

			totalMatches++
			matches = append(matches, item)
			if item.Kind != "" {
				matchKinds[item.Kind] = struct{}{}
			}
			matchNamespaces[item.Namespace] = struct{}{}
		}
	}

	if len(matches) > 1 {
		sortSummaries(matches)
	}

	end := start + limit
	if end > len(matches) {
		end = len(matches)
	}

	filtered := make([]Summary, 0, limit)
	if start < len(matches) {
		filtered = append(filtered, matches[start:end]...)
	}

	var next string
	if totalMatches > end {
		next = strconv.Itoa(end)
	}

	resourceCount := countMatchingDescriptors(cachedDescriptors, kindMatcher)

	kinds := cachedKinds
	if hasNamespaceFilter {
		if len(namespaceKinds) > 0 {
			kinds = snapshotSortedKeys(namespaceKinds)
		} else {
			kinds = []string{}
		}
	} else if len(kinds) == 0 && len(matchKinds) > 0 {
		kinds = snapshotSortedKeys(matchKinds)
	}

	namespaces := cachedNamespaces
	if len(namespaces) == 0 && len(matchNamespaces) > 0 {
		namespaces = snapshotSortedKeys(matchNamespaces)
	}

	return QueryResult{
		Items:         filtered,
		ContinueToken: next,
		TotalItems:    totalMatches,
		ResourceCount: resourceCount,
		Kinds:         kinds,
		Namespaces:    namespaces,
	}
}

func (s *Service) queryWithoutCache(
	opts QueryOptions,
	kindMatcher kindMatcher,
	namespaceMatcher namespaceMatcher,
	searchMatcher searchMatcher,
) QueryResult {
	items := s.Snapshot()
	descriptors := s.Descriptors()

	kindSet := make(map[string]struct{})
	namespaceSet := make(map[string]struct{})
	// Scope the kinds list to namespace-filtered items when a namespace filter is active.
	namespaceKinds := make(map[string]struct{})
	hasNamespaceFilter := len(opts.Namespaces) > 0
	for _, item := range items {
		if item.Kind != "" {
			kindSet[item.Kind] = struct{}{}
		}
		if item.Namespace != "" {
			namespaceSet[item.Namespace] = struct{}{}
		}
		if hasNamespaceFilter && namespaceMatcher(item.Namespace, item.Scope) {
			if item.Kind != "" {
				namespaceKinds[item.Kind] = struct{}{}
			}
		}
	}

	filtered := make([]Summary, 0, len(items))
	for _, item := range items {
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
		if filtered[i].Kind != filtered[j].Kind {
			return filtered[i].Kind < filtered[j].Kind
		}
		if filtered[i].Namespace != filtered[j].Namespace {
			return filtered[i].Namespace < filtered[j].Namespace
		}
		return filtered[i].Name < filtered[j].Name
	})

	total := len(filtered)
	limit := clampQueryLimit(opts.Limit)
	start := parseContinueToken(opts.Continue, total)
	end := start + limit
	if end > total {
		end = total
	}

	page := make([]Summary, end-start)
	copy(page, filtered[start:end])

	var next string
	if end < total {
		next = strconv.Itoa(end)
	}

	resourceCount := countMatchingDescriptors(descriptors, kindMatcher)

	kindSource := kindSet
	if hasNamespaceFilter {
		kindSource = namespaceKinds
	}
	kinds := make([]string, 0, len(kindSource))
	for kind := range kindSource {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)

	namespaces := make([]string, 0, len(namespaceSet))
	for ns := range namespaceSet {
		namespaces = append(namespaces, ns)
	}
	sort.Strings(namespaces)

	return QueryResult{
		Items:         page,
		ContinueToken: next,
		TotalItems:    total,
		ResourceCount: resourceCount,
		Kinds:         kinds,
		Namespaces:    namespaces,
	}
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
		candidates := []string{
			strings.ToLower(kind),
			strings.ToLower(group + "/" + kind),
			strings.ToLower(resource),
			strings.ToLower(group + "/" + resource),
			strings.ToLower(group + "/" + version + "/" + resource),
		}
		for _, candidate := range candidates {
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
