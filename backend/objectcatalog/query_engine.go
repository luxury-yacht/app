/*
 * backend/objectcatalog/query_engine.go
 *
 * Serves catalog Browse/object-catalog queries through the shared querypage.Store
 * engine — the catalog's single query implementation. A *querypage.Store[Summary] is
 * maintained from each published summary set, and queryViaEngine maps a QueryOptions
 * onto a querypage.Query and the resulting Page back onto a QueryResult. The encoded
 * sort/UID values fold in the catalog's identity chain (compareCatalogIdentity) as the
 * tiebreak so the engine orders rows by the catalog's canonical order.
 */

package objectcatalog

import (
	"fmt"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// querypage sort-key names. They are lowercase to match the request's normalized
// sort field (normalizeCatalogQuerySortField lowercases). The default composite is
// the catalog's identity chain (kind/namespace/name/...).
const (
	catalogEngineSortDefault           = catalogQueryDefaultSort // "kind/namespace/name"
	catalogEngineSortKind              = "kind"
	catalogEngineSortNamespace         = "namespace"
	catalogEngineSortName              = "name"
	catalogEngineSortAge               = "age"
	catalogEngineSortCreationTimestamp = "creationtimestamp"
)

// querypage facet names.
const (
	catalogEngineFacetKindIdentity = "kindidentity"
	catalogEngineFacetNamespace    = "namespace"
	catalogEngineFacetCustom       = "custom"
)

// catalogEngineNoMatchFacetValue is not a valid catalogEngineKindIdentity value:
// kind identities contain group/version/kind separated by catalogEngineFieldSep.
const catalogEngineNoMatchFacetValue = catalogEngineFieldSep + "catalog-engine-no-match"

// catalogEngineFieldSep separates identity components inside an encoded sort/UID
// value. NUL can never appear in a Kubernetes identifier, so a concatenation of
// fields with this separator is collision-free and order-preserving componentwise.
const catalogEngineFieldSep = "\x00"

// newCatalogQueryStoreSchema returns the querypage Schema describing how the engine
// reads a Summary: a unique UID, the catalog's sort orders, the facet dimensions, and
// the searchable text. The encoded values reproduce the catalog's canonical order
// (the age newest-first flip and the compareCatalogIdentity tiebreak in helpers.go), so
// a querypage page lays rows out in the catalog's canonical order.
func newCatalogQueryStoreSchema() querypage.Schema[Summary] {
	return querypage.Schema[Summary]{
		// UID is the catalog's full identity chain (kind/namespace/name/group/version/
		// resource/uid). It is unique per published summary (a superset of the items-map
		// key gvr/ns/name) and its ascending order equals compareCatalogIdentity, so the
		// engine's always-ascending UID tiebreak reproduces the catalog tiebreak.
		UID: catalogEngineUID,
		SortKeys: map[string]func(Summary) string{
			// The default composite IS the identity chain, so the encoded value is the
			// full chain and is therefore unique: a desc request reverses the whole
			// value (engine descLess), matching the catalog's -compareCatalogIdentity.
			catalogEngineSortDefault: catalogEngineUID,
			// Explicit-field sorts break ties by the ascending identity chain in both
			// directions. The engine's UID tiebreak (== the identity chain,
			// compareCatalogIdentity) supplies exactly that, so the encoded value is
			// just the field value.
			catalogEngineSortKind:      func(s Summary) string { return s.Kind },
			catalogEngineSortNamespace: func(s Summary) string { return s.Namespace },
			catalogEngineSortName:      func(s Summary) string { return s.Name },
			// Both "age" and "creationtimestamp" sort newest-first when ascending: the
			// catalog flips BOTH age AND creationtimestamp, so "asc" means newest first.
			// Encoding the creation
			// timestamp inverted makes an ascending walk produce newest-first; a desc
			// walk (engine descLess) then yields oldest-first, matching the legacy "desc".
			catalogEngineSortAge:               func(s Summary) string { return catalogEngineInvertTimestamp(s.CreationTimestamp) },
			catalogEngineSortCreationTimestamp: func(s Summary) string { return catalogEngineInvertTimestamp(s.CreationTimestamp) },
		},
		Facets: map[string]func(Summary) string{
			// Canonical identity group\x00version\x00kind (lowercased kind, matching
			// identityKey). Rows sharing this value match every kind filter identically,
			// so a filter is honored by expanding it to the set of matching identities.
			catalogEngineFacetKindIdentity: catalogEngineKindIdentity,
			// Namespace facet uses the catalog's namespace index representation:
			// "cluster" for cluster-scoped/empty-namespace rows, else the lowercased
			// namespace — matching catalogQueryNamespaceIndexKey and the filter keys.
			catalogEngineFacetNamespace: func(s Summary) string { return catalogQueryNamespaceIndexKey(s.Namespace, s.Scope) },
			// custom = "true" for non-built-in (discovered/CRD) rows, "false" otherwise,
			// reusing the catalog's builtin check (catalogQueryBuiltinKeys).
			catalogEngineFacetCustom: func(s Summary) string {
				if catalogSummaryIsCustom(s) {
					return "true"
				}
				return "false"
			},
		},
		// Search matches the same fields as newSearchMatcher: name + namespace + kind.
		// Join with NUL so a single case-insensitive Contains can never match across a
		// field boundary (no real needle contains NUL), matching the per-field matcher.
		SearchText: func(s Summary) string {
			return strings.Join([]string{s.Name, s.Namespace, s.Kind}, catalogEngineFieldSep)
		},
	}
}

// catalogEngineUID encodes the catalog identity chain
// (kind/namespace/name/group/version/resource/uid) as a single order-preserving
// string. Its ascending lexical order equals compareCatalogIdentity.
func catalogEngineUID(s Summary) string {
	return strings.Join([]string{
		s.Kind, s.Namespace, s.Name, s.Group, s.Version, s.Resource, s.UID,
	}, catalogEngineFieldSep)
}

// catalogEngineKindIdentity is the canonical kind facet value: the same key
// identityKey(group,version,kind) produces, flattened to a string.
func catalogEngineKindIdentity(s Summary) string {
	key := identityKey(s.Group, s.Version, s.Kind)
	return key.group + catalogEngineFieldSep + key.version + catalogEngineFieldSep + key.kind
}

// catalogSummaryIsCustom reports whether a summary is a non-built-in (discovered/CRD)
// kind, reusing the catalog's builtin identity set.
func catalogSummaryIsCustom(s Summary) bool {
	_, builtin := catalogQueryBuiltinKeys[identityKey(s.Group, s.Version, s.Kind)]
	return !builtin
}

// catalogEngineEmptyAgeSentinel sorts AFTER every inverted real timestamp, so an
// empty creation timestamp (oldest) ends up last in "age ascending" (newest-first) —
// matching the legacy age comparator, where an empty raw timestamp is the smallest
// and the age flip pushes it to the end. 0x7f exceeds every printable-complement
// byte (≤ 0x7e), is valid ASCII, and so survives the JSON cursor round-trip.
const catalogEngineEmptyAgeSentinel = "\x7f"

// catalogEngineInvertTimestamp maps a creation-timestamp string to an
// order-preserving, JSON-safe inverse: ascending lexical order over the result equals
// descending (newest-first) order over the input, reproducing the catalog's age flip
// (helpers.go, "age asc" = newest first).
//
// The cursor stores a sort value as a JSON string (querypage.Cursor.Position), so the
// encoded value MUST be valid UTF-8 — a raw byte complement (0xFF-c) produces invalid
// UTF-8 that JSON mangles, corrupting the cursor. Instead each byte is complemented
// WITHIN the printable ASCII range [0x20,0x7e]: c -> 0x20 + 0x7e - c. RFC3339
// timestamp bytes ('0'..'9', '-', ':', 'T', 'Z', '+', '.') all lie in that range, so
// the result stays printable ASCII and equal-length inputs reverse lexical order.
func catalogEngineInvertTimestamp(ts string) string {
	if ts == "" {
		return catalogEngineEmptyAgeSentinel
	}
	b := []byte(ts)
	for i := range b {
		c := b[i]
		if c >= 0x20 && c <= 0x7e {
			b[i] = 0x20 + 0x7e - c
		}
		// Bytes outside printable ASCII are left as-is. Catalog timestamps are
		// RFC3339 (always printable), so this branch is unreachable for real data;
		// leaving such a byte unchanged keeps the value JSON-safe without panicking.
	}
	return string(b)
}

// catalogEngineSortKey maps a normalized request sort field to the schema sort-key
// name. The catalog normalizes "creation-timestamp" to "creationtimestamp" already;
// the default and unknown fields fall back to the identity composite.
func catalogEngineSortKey(field string) string {
	switch field {
	case catalogEngineSortKind, catalogEngineSortNamespace, catalogEngineSortName, catalogEngineSortAge:
		return field
	case "creationtimestamp", "creation-timestamp":
		return catalogEngineSortCreationTimestamp
	default:
		return catalogEngineSortDefault
	}
}

// catalogEngineDirection maps the normalized request direction to a querypage
// Direction.
func catalogEngineDirection(direction string) querypage.Direction {
	if direction == "desc" {
		return querypage.Descending
	}
	return querypage.Ascending
}

// catalogEngineSignature pins a cursor to its query shape so a cursor minted for one
// filter/sort/scope can never mispage a different one. It folds in limit, search, kinds,
// namespaces, customOnly, and sort, so the cursor binds to exactly that query identity.
func catalogEngineSignature(opts QueryOptions, limit int) string {
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

// catalogEngineKindFilterIdentities expands a kind filter into the exact set of
// canonical kindidentity facet values it selects, by running the real candidate-key
// matcher (newKindMatcher) over the distinct identities present in the store. The
// engine's single-value facet cannot express the catalog's "match if any of the
// row's six candidate keys is in the filter" rule directly, so the filter side is
// resolved to identities instead. Rows sharing a canonical identity (group/version/
// kind) always match a kind filter identically (the matcher reads only kind/group/
// version/resource, and a GVK maps to one resource in the catalog), so this is exact.
func catalogEngineKindFilterIdentities(rows []Summary, kinds []string) []string {
	matcher := newKindMatcher(kinds)
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, row := range rows {
		identity := catalogEngineKindIdentity(row)
		if _, ok := seen[identity]; ok {
			continue
		}
		seen[identity] = struct{}{}
		if matcher(row.Kind, row.Group, row.Version, row.Resource) {
			result = append(result, identity)
		}
	}
	sort.Strings(result)
	return result
}

// catalogEngineNamespaceFilterValues maps the request namespace filter to the facet
// values the namespace facet uses. It reproduces newNamespaceMatcher's meaning:
// a "cluster"/empty filter selects the "cluster" bucket; named namespaces select the
// lowercased namespace bucket. With named namespaces present, cluster-scoped rows are
// excluded unless "cluster" is also requested — the same rule the matcher enforces.
func catalogEngineNamespaceFilterValues(namespaces []string) []string {
	if len(namespaces) == 0 {
		return nil
	}
	return catalogQueryNamespaceFilterKeys(namespaces)
}

// queryViaEngine serves a catalog query through the maintained querypage store — the
// catalog's single query implementation. Fed the published state, it returns the
// QueryResult (items/order, totals, facets, pagination). It is read-only over the store
// snapshot taken under the service read lock, so it never blocks ingestion for longer
// than a snapshot copy.
func (s *Service) queryViaEngine(opts QueryOptions) (QueryResult, bool) {
	s.mu.RLock()
	store := s.catalogIndex.queryEngineStore
	descriptors := append([]Descriptor(nil), s.catalogIndex.cachedDescriptors...)
	cachedKinds := append([]KindInfo(nil), s.catalogIndex.cachedKinds...)
	cachedNamespaces := append([]string(nil), s.catalogIndex.cachedNamespaces...)
	s.mu.RUnlock()

	// An empty engine store means no chunks have been published (or the catalog was
	// reset). queryViaEngineFromSnapshot serves that case on the same engine from the
	// items-map snapshot, so the catalog has ONE query implementation.
	if store == nil || store.Len() == 0 {
		return s.queryViaEngineFromSnapshot(opts, descriptors)
	}
	// Maintained-store path: facets resolve from the publish-time cached kinds/namespaces
	// lists (catalogEngineFacets).
	rows := store.Snapshot()
	resolveFacets := func(metadataExact bool) ([]KindInfo, []string) {
		return catalogEngineFacets(rows, opts, cachedKinds, cachedNamespaces, metadataExact)
	}
	return s.queryViaEngineWithStore(opts, store, rows, descriptors, resolveFacets), true
}

// queryViaEngineFromSnapshot serves a query when no chunks have been published, by
// building an ephemeral engine store from the items-map snapshot. Its facets are the
// full in-scope kind/namespace sets (catalogEngineSnapshotFacets), NOT the filter-scoped
// match sets the maintained-store path uses — a deliberate, distinct facet contract for
// the snapshot path (see catalogEngineSnapshotFacets).
func (s *Service) queryViaEngineFromSnapshot(opts QueryOptions, descriptors []Descriptor) (QueryResult, bool) {
	rows := s.Snapshot()
	if len(descriptors) == 0 {
		descriptors = s.Descriptors()
	}
	store := querypage.NewStore(newCatalogQueryStoreSchema())
	for _, row := range rows {
		store.Upsert(row)
	}
	resolveFacets := func(metadataExact bool) ([]KindInfo, []string) {
		return catalogEngineSnapshotFacets(rows, opts, metadataExact)
	}
	return s.queryViaEngineWithStore(opts, store, rows, descriptors, resolveFacets), true
}

// queryViaEngineWithStore maps a query onto a prepared store + row set and the Page
// back onto a QueryResult. Both the maintained-store and ephemeral-snapshot paths use
// it (each supplying its own facet resolver), so the catalog serves every query
// through one engine mapping.
func (s *Service) queryViaEngineWithStore(
	opts QueryOptions,
	store *querypage.Store[Summary],
	rows []Summary,
	descriptors []Descriptor,
	resolveFacets func(metadataExact bool) ([]KindInfo, []string),
) QueryResult {
	limit := clampQueryLimit(opts.Limit)
	sortKey := catalogEngineSortKey(normalizeCatalogQuerySortField(opts.SortField))
	direction := catalogEngineDirection(normalizeCatalogQuerySortDirection(opts.SortDirection))
	signature := catalogEngineSignature(opts, limit)

	filters := s.catalogEngineFilters(rows, opts)

	// Cursor decode/validate and the backward dead-end rule are owned by the engine
	// (querypage.Store.Query): an invalid token restarts at page 1 (NextCursor/
	// PrevCursor recomputed from the first page), a backward cursor whose
	// predecessors were all deleted returns the empty dead-end page, and both
	// surface on page.CursorInvalid — that flag only tells the frontend to reset.
	engineQuery := querypage.Query{
		ClusterID: s.clusterID,
		Signature: signature,
		Sort:      sortKey,
		Direction: direction,
		Limit:     limit,
		Search:    opts.Search,
		Filters:   filters,
	}
	var page querypage.Page[Summary]
	var err error
	var anchorOutcome *querypage.AnchorOutcome
	if opts.StartRank != nil && opts.Anchor == nil {
		// Numbered page jump: the engine clamps past-the-end starts to the last
		// aligned page and reports the served rank on PageStartRank.
		page, err = store.QueryAt(engineQuery, *opts.StartRank)
	} else if opts.Anchor != nil {
		// Resolve the anchor to the engine's row key via the summary snapshot.
		// The engine store holds ALL published summaries (filters apply at query
		// time), so once the key resolves, the engine's found/filtered outcome is
		// authoritative; an unresolved key (absent, or UID identity mismatch)
		// walks the engine's not-found path — first page + reason.
		key := ""
		if summary, ok := findAnchorSummary(rows, opts.Anchor); ok {
			key = catalogEngineUID(summary)
		}
		var outcome querypage.AnchorOutcome
		page, outcome, err = store.QueryAround(engineQuery, key)
		anchorOutcome = &outcome
	} else {
		engineQuery.Cursor = opts.Continue
		page, err = store.Query(engineQuery)
	}
	if err != nil {
		// The only remaining engine error is an unknown sort key; sortKey is
		// normalized above, so this is defensive.
		page = querypage.Page[Summary]{PageStartRank: -1}
	}

	unfilteredTotal, unfilteredExact := s.catalogEngineUnfilteredTotal(store, opts, page.Total)
	metadataExact := page.Total <= catalogQueryExactMetadataThreshold

	kinds, namespaces := resolveFacets(metadataExact)

	return QueryResult{
		Items:           page.Rows,
		ContinueToken:   page.NextCursor,
		PreviousToken:   page.PrevCursor,
		SelfToken:       page.SelfCursor,
		CursorInvalid:   page.CursorInvalid,
		TotalItems:      page.Total,
		UnfilteredTotal: unfilteredTotal,
		TotalIsExact:    metadataExact && unfilteredExact,
		ResourceCount:   countMatchingDescriptorsWithOptions(descriptors, newKindMatcher(opts.Kinds), opts),
		Kinds:           kinds,
		Namespaces:      namespaces,
		FacetsExact:     metadataExact,
		AnchorOutcome:   anchorOutcome,
		PageStartRank:   page.PageStartRank,
	}
}

// findAnchorSummary resolves an anchor reference to its published summary by
// exact group/version/namespace/name and case-insensitive kind (mirroring the
// typed path's lowercased row keys). When the anchor carries a UID and the
// resolved summary's differs, the object was deleted and recreated under the
// same identity — the anchor no longer exists, so resolution fails and the
// engine reports not-found.
func findAnchorSummary(rows []Summary, anchor *QueryAnchor) (Summary, bool) {
	for _, s := range rows {
		if s.Namespace != anchor.Namespace || s.Name != anchor.Name {
			continue
		}
		if s.Group != anchor.Group || s.Version != anchor.Version {
			continue
		}
		if !strings.EqualFold(s.Kind, anchor.Kind) {
			continue
		}
		if anchor.UID != "" && s.UID != anchor.UID {
			return Summary{}, false
		}
		return s, true
	}
	return Summary{}, false
}

// catalogEngineFilters builds the querypage facet filters for a query: the kind
// filter is expanded to the matching canonical identities, the namespace filter to
// the namespace facet buckets, and CustomOnly to the custom="true" bucket.
func (s *Service) catalogEngineFilters(rows []Summary, opts QueryOptions) map[string][]string {
	filters := make(map[string][]string)
	if kinds := normalizeQueryValues(opts.Kinds); len(kinds) > 0 {
		values := catalogEngineKindFilterIdentities(rows, kinds)
		if len(values) == 0 {
			values = []string{catalogEngineNoMatchFacetValue}
		}
		filters[catalogEngineFacetKindIdentity] = values
	}
	if values := catalogEngineNamespaceFilterValues(opts.Namespaces); len(values) > 0 {
		filters[catalogEngineFacetNamespace] = values
	}
	if opts.CustomOnly {
		filters[catalogEngineFacetCustom] = []string{"true"}
	}
	return filters
}

// catalogEngineUnfilteredTotal mirrors unfilteredScopeTotal: the in-scope count
// before the query's kind/namespace/search filters (custom-only still honored). With
// no user filter active it equals the already-computed filtered total; otherwise it is
// a second store query with those filters cleared.
func (s *Service) catalogEngineUnfilteredTotal(store *querypage.Store[Summary], opts QueryOptions, filteredTotal int) (int, bool) {
	if len(opts.Kinds) == 0 && len(opts.Namespaces) == 0 && opts.Search == "" {
		return filteredTotal, filteredTotal <= catalogQueryExactMetadataThreshold
	}
	filters := make(map[string][]string)
	if opts.CustomOnly {
		filters[catalogEngineFacetCustom] = []string{"true"}
	}
	page, err := store.Query(querypage.Query{
		ClusterID: s.clusterID,
		Signature: catalogEngineSignature(QueryOptions{CustomOnly: opts.CustomOnly}, clampQueryLimit(opts.Limit)),
		Sort:      catalogEngineSortDefault,
		Direction: querypage.Ascending,
		Limit:     1,
		Filters:   filters,
	})
	if err != nil {
		return filteredTotal, true
	}
	return page.Total, page.Total <= catalogQueryExactMetadataThreshold
}

// catalogEngineFacets derives the maintained-store path's Kinds/Namespaces facets over
// the store snapshot, using the publish-time cached lists:
//   - Kinds: customOnly → kinds among custom matches; namespace filter → kinds present
//     in the filtered namespaces; otherwise the full cached kinds list.
//   - Namespaces: the full cached namespaces list (or, when none were cached but matches
//     contribute namespaces, the matched namespaces).
//
// When the match count exceeds the exact-metadata threshold the match-facet contribution
// is dropped; metadataExact carries that, so the facet derivation stays consistent.
func catalogEngineFacets(rows []Summary, opts QueryOptions, cachedKinds []KindInfo, cachedNamespaces []string, metadataExact bool) ([]KindInfo, []string) {
	kindMatcher := newKindMatcher(opts.Kinds)
	namespaceMatcher := newNamespaceMatcher(opts.Namespaces)
	searchMatcher := newSearchMatcher(opts.Search)
	customMatcher := newCustomOnlyMatcher(opts.CustomOnly)

	matchKinds := make(map[string]bool)
	matchNamespaces := make(map[string]struct{})
	namespaceKinds := make(map[string]bool)
	hasNamespaceFilter := len(opts.Namespaces) > 0

	if metadataExact {
		for _, item := range rows {
			if !customMatcher(item) {
				continue
			}
			if hasNamespaceFilter && namespaceMatcher(item.Namespace, item.Scope) && item.Kind != "" {
				namespaceKinds[item.Kind] = item.Scope == ScopeNamespace
			}
			if !matchesCatalogQuery(item, kindMatcher, namespaceMatcher, searchMatcher) {
				continue
			}
			if item.Kind != "" {
				matchKinds[item.Kind] = item.Scope == ScopeNamespace
			}
			if item.Namespace != "" {
				matchNamespaces[item.Namespace] = struct{}{}
			}
		}
	}

	kinds := cachedKinds
	switch {
	case opts.CustomOnly:
		kinds = snapshotSortedKindInfos(matchKinds)
	case hasNamespaceFilter:
		if len(namespaceKinds) > 0 {
			kinds = snapshotSortedKindInfos(namespaceKinds)
		} else {
			kinds = []KindInfo{}
		}
	case len(cachedKinds) == 0 && len(matchKinds) > 0:
		kinds = snapshotSortedKindInfos(matchKinds)
	}

	namespaces := cachedNamespaces
	if len(cachedNamespaces) == 0 && len(matchNamespaces) > 0 {
		namespaces = snapshotSortedKeys(matchNamespaces)
	}

	return kinds, namespaces
}

// catalogEngineSnapshotFacets derives the ephemeral-snapshot path's facets (it has no
// publish-time cached facet lists). Unlike the maintained-store path (catalogEngineFacets),
// the Namespaces facet is the FULL in-scope namespace set (every custom-matched namespace
// in the snapshot), independent of the kind/namespace/search filter — so a cluster-scope
// filter still surfaces the cluster's namespaces in the facet list. Kinds are the full
// custom-matched kind set, scoped to the filtered namespaces only when a namespace filter
// is active. CustomOnly is honored solely by customMatcher gating the universe — there is
// no separate CustomOnly kind branch.
func catalogEngineSnapshotFacets(rows []Summary, opts QueryOptions, metadataExact bool) ([]KindInfo, []string) {
	namespaceMatcher := newNamespaceMatcher(opts.Namespaces)
	customMatcher := newCustomOnlyMatcher(opts.CustomOnly)
	hasNamespaceFilter := len(opts.Namespaces) > 0

	kindSet := make(map[string]bool)
	namespaceSet := make(map[string]struct{})
	namespaceKinds := make(map[string]bool)

	if metadataExact {
		for _, item := range rows {
			if !customMatcher(item) {
				continue
			}
			if item.Kind != "" {
				kindSet[item.Kind] = item.Scope == ScopeNamespace
			}
			if item.Namespace != "" {
				namespaceSet[item.Namespace] = struct{}{}
			}
			if hasNamespaceFilter && namespaceMatcher(item.Namespace, item.Scope) && item.Kind != "" {
				namespaceKinds[item.Kind] = item.Scope == ScopeNamespace
			}
		}
	}

	kindSource := kindSet
	if hasNamespaceFilter {
		kindSource = namespaceKinds
	}
	return snapshotSortedKindInfos(kindSource), snapshotSortedKeys(namespaceSet)
}
