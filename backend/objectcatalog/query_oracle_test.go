/*
 * backend/objectcatalog/query_oracle_test.go
 *
 * Property-based oracle for the catalog query engine. For several DETERMINISTIC
 * seeds it generates a randomized-but-valid universe of catalog summaries, publishes
 * them through the same path the case-based tests use, and then — for a matrix of
 * sort × direction × namespace filter × gvk filter × search term × page size —
 * compares the engine's full, page-walked result against an independent brute-force
 * oracle computed in plain Go.
 *
 * The oracle replicates the engine's EXACT total order: the per-field encoded sort
 * value (query_engine.go newCatalogQueryStoreSchema) with the engine's direction
 * semantics (querypage store.go ascLess/descLess: value asc|desc, UID tiebreak ALWAYS
 * ascending), where the UID is catalogEngineUID (the identity chain). Object UIDs are
 * generated unique, so the identity-chain tiebreak is always decisive and the oracle
 * can reproduce the engine order precisely (no guessed tiebreak). The oracle's filter
 * and search predicates reuse the catalog's own source-of-truth matchers
 * (newKindMatcher / newNamespaceMatcher / newSearchMatcher / newCustomOnlyMatcher via
 * matchesCatalogQuery), which are exactly what the engine's facet filters are derived
 * from (query_engine.go catalogEngineFilters/catalogEngineKindFilterIdentities/
 * catalogEngineNamespaceFilterValues + the custom facet).
 *
 * The assertions are stronger than the case-based tests: the engine's full ordered
 * identity sequence must EQUAL the oracle's sequence, page-walking must visit every
 * matching object exactly once (no duplicates, no gaps), and the reported unfiltered
 * total must equal the oracle's in-scope count.
 */

package objectcatalog

import (
	"fmt"
	"math/rand"
	"sort"
	"testing"
)

// oracleKind is one entry in the small fixed GVK vocabulary the generator draws from.
// The built-in flag is informational only — the catalog classifies built-in vs custom
// from its own builtin identity set (catalogQueryBuiltinKeys); these GVKs are chosen so
// that classification is exercised (core/apps groups are built-in; example.com is not),
// matching the vocabulary the existing pagination test relies on.
type oracleKind struct {
	kind     string
	group    string
	version  string
	resource string
	scope    Scope
}

// oracleKinds is a small fixed set of valid GVKs: built-in namespaced + cluster-scoped
// kinds and custom (CRD) namespaced + cluster-scoped kinds. Group "" and "apps" are
// built-in (BuiltinResources); "example.com" is custom — the same split the
// equivalence/pagination test uses, so custom-only filtering is genuinely exercised.
var oracleKinds = []oracleKind{
	{"Pod", "", "v1", "pods", ScopeNamespace},
	{"Service", "", "v1", "services", ScopeNamespace},
	{"ConfigMap", "", "v1", "configmaps", ScopeNamespace},
	{"Deployment", "apps", "v1", "deployments", ScopeNamespace},
	{"Node", "", "v1", "nodes", ScopeCluster},
	{"Namespace", "", "v1", "namespaces", ScopeCluster},
	{"Widget", "example.com", "v1", "widgets", ScopeNamespace},
	{"ClusterWidget", "example.com", "v1", "clusterwidgets", ScopeCluster},
}

// oracleNamespaces is the namespace pool for namespaced objects. Cluster-scoped objects
// always get an empty namespace regardless of this pool.
var oracleNamespaces = []string{"default", "kube-system", "app", "team-alpha"}

// oracleNameStems are shared name fragments so generated names collide on substrings
// (search hits) and prefixes (sort ties on the name field) across many objects.
var oracleNameStems = []string{"alpha", "beta", "gamma", "svc", "cfg", "worker", "edge"}

// oracleTimestamps is a small pool (with the empty/no-timestamp case) so the age sort
// is exercised with ties AND the empty-timestamp sentinel (sorts last in age-asc).
var oracleTimestamps = []string{
	"",
	"2023-11-01T00:00:00Z",
	"2024-01-01T00:00:00Z",
	"2024-01-01T00:00:00Z", // duplicate on purpose: forces age ties (broken by identity chain)
	"2024-06-15T12:30:00Z",
	"2025-03-09T08:00:00Z",
	"2026-01-01T00:00:00Z",
}

// generateOracleObjects builds n randomized-but-valid summaries from a deterministic
// rng. Every object gets a UNIQUE UID (obj-<i>), so the identity-chain tiebreak is
// always decisive and the oracle can reproduce the engine order exactly without
// guessing a tiebreak. Cluster-scoped kinds get an empty namespace + ScopeCluster;
// namespaced kinds draw a namespace from the pool.
func generateOracleObjects(rng *rand.Rand, n int) []Summary {
	items := make([]Summary, 0, n)
	for i := 0; i < n; i++ {
		gvk := oracleKinds[rng.Intn(len(oracleKinds))]

		namespace := ""
		if gvk.scope == ScopeNamespace {
			namespace = oracleNamespaces[rng.Intn(len(oracleNamespaces))]
		}

		// Names share stems so search substrings and name-sort ties occur, and a numeric
		// suffix keeps two objects of the same kind+namespace from colliding into the same
		// items-map key (gvr/ns/name) — distinct keys keep all n objects published.
		name := fmt.Sprintf("%s-%s-%d", oracleNameStems[rng.Intn(len(oracleNameStems))], oracleNameStems[rng.Intn(len(oracleNameStems))], i)

		created := oracleTimestamps[rng.Intn(len(oracleTimestamps))]

		items = append(items, Summary{
			ClusterID:         "cluster-a",
			Kind:              gvk.kind,
			Group:             gvk.group,
			Version:           gvk.version,
			Resource:          gvk.resource,
			Namespace:         namespace,
			Name:              name,
			UID:               fmt.Sprintf("obj-%d", i),
			CreationTimestamp: created,
			Scope:             gvk.scope,
		})
	}
	return items
}

// oracleEncodedSortValue reproduces the engine's encoded sort value for a summary and
// normalized sort field, mirroring newCatalogQueryStoreSchema's SortKeys exactly.
func oracleEncodedSortValue(s Summary, sortKey string) string {
	switch sortKey {
	case catalogEngineSortKind:
		return s.Kind
	case catalogEngineSortNamespace:
		return s.Namespace
	case catalogEngineSortName:
		return s.Name
	case catalogEngineSortAge, catalogEngineSortCreationTimestamp:
		return catalogEngineInvertTimestamp(s.CreationTimestamp)
	default:
		// Default composite IS the identity chain (== UID), so the encoded value equals
		// the UID; the schema maps catalogEngineSortDefault -> catalogEngineUID.
		return catalogEngineUID(s)
	}
}

// oracleSort orders a copy of items by the engine's contract for (sortKey, direction):
// ascending => (value asc, UID asc); descending => (value desc, UID asc). The UID
// tiebreak is ALWAYS ascending in both directions (querypage store.go descLess), and
// UID == catalogEngineUID is unique here, so this is a strict total order.
func oracleSort(items []Summary, sortKey, direction string) []Summary {
	sorted := append([]Summary(nil), items...)
	desc := direction == "desc"
	sort.SliceStable(sorted, func(i, j int) bool {
		vi := oracleEncodedSortValue(sorted[i], sortKey)
		vj := oracleEncodedSortValue(sorted[j], sortKey)
		if vi != vj {
			if desc {
				return vi > vj
			}
			return vi < vj
		}
		// Tiebreak: identity chain (catalogEngineUID) ascending, regardless of direction.
		return catalogEngineUID(sorted[i]) < catalogEngineUID(sorted[j])
	})
	return sorted
}

// oracleFilterAndSort computes the brute-force expected ordered identity sequence for a
// query: filter the universe with the catalog's own matchers (the source-of-truth
// predicates the engine's facet filters are derived from), then sort by the engine's
// contract.
func oracleFilterAndSort(universe []Summary, opts QueryOptions) []Summary {
	kindMatcher := newKindMatcher(opts.Kinds)
	namespaceMatcher := newNamespaceMatcher(opts.Namespaces)
	searchMatcher := newSearchMatcher(opts.Search)
	customMatcher := newCustomOnlyMatcher(opts.CustomOnly)

	matched := make([]Summary, 0, len(universe))
	for _, item := range universe {
		if !customMatcher(item) {
			continue
		}
		if !matchesCatalogQuery(item, kindMatcher, namespaceMatcher, searchMatcher) {
			continue
		}
		matched = append(matched, item)
	}

	sortKey := catalogEngineSortKey(normalizeCatalogQuerySortField(opts.SortField))
	direction := normalizeCatalogQuerySortDirection(opts.SortDirection)
	return oracleSort(matched, sortKey, direction)
}

// oracleUnfilteredCount is the in-scope count before the kind/namespace/search filters
// (custom-only still honored) — the oracle for QueryResult.UnfilteredTotal
// (catalogEngineUnfilteredTotal / unfilteredScopeTotal).
func oracleUnfilteredCount(universe []Summary, customOnly bool) int {
	customMatcher := newCustomOnlyMatcher(customOnly)
	count := 0
	for _, item := range universe {
		if customMatcher(item) {
			count++
		}
	}
	return count
}

// walkEngine pages the engine forward to exhaustion via keyset cursor continuation,
// returning the full ordered UID sequence. It also asserts no page exceeds the limit,
// no UID is returned on more than one page, and the reported TotalItems/UnfilteredTotal
// stay stable across every page.
func walkEngine(t *testing.T, svc *Service, base QueryOptions, label string) (ordered []string, totalItems, unfilteredTotal int) {
	t.Helper()

	token := ""
	seen := map[string]bool{}
	wantTotal, wantUnfiltered := -1, -1

	for page := 0; page < 10000; page++ {
		opts := base
		opts.Continue = token
		result := svc.Query(opts)

		if page == 0 {
			wantTotal, wantUnfiltered = result.TotalItems, result.UnfilteredTotal
		} else {
			if result.TotalItems != wantTotal {
				t.Fatalf("%s page %d: TotalItems drifted %d -> %d", label, page, wantTotal, result.TotalItems)
			}
			if result.UnfilteredTotal != wantUnfiltered {
				t.Fatalf("%s page %d: UnfilteredTotal drifted %d -> %d", label, page, wantUnfiltered, result.UnfilteredTotal)
			}
		}

		if len(result.Items) > clampQueryLimit(base.Limit) {
			t.Fatalf("%s page %d: page size %d exceeds clamped limit %d", label, page, len(result.Items), clampQueryLimit(base.Limit))
		}

		for _, item := range result.Items {
			uid := catalogEngineUID(item)
			if seen[uid] {
				t.Fatalf("%s page %d: row %q returned on more than one page (duplicate)", label, page, uid)
			}
			seen[uid] = true
			ordered = append(ordered, uid)
		}

		if result.ContinueToken == "" {
			return ordered, wantTotal, wantUnfiltered
		}
		token = result.ContinueToken
	}
	t.Fatalf("%s: pagination did not terminate within page budget", label)
	return nil, 0, 0
}

// TestCatalogQueryMatchesBruteForceOracle is a seeded, property-based oracle for the
// catalog query engine. Across several deterministic seeds it generates a randomized
// universe of summaries and, for a matrix of sort × direction × namespace filter × gvk
// filter × search term × page size, asserts that the engine's page-walked ordered
// identity sequence EQUALS an independent brute-force computation, that pagination
// covers every matching object exactly once (no duplicates, no gaps), and that the
// reported totals match the oracle's counts.
func TestCatalogQueryMatchesBruteForceOracle(t *testing.T) {
	seeds := []int64{1, 7, 42}

	// Sort dimension: every sort field the catalog supports × both directions, plus the
	// default (empty field) composite. catalogEngineSortKey normalizes these.
	sorts := []struct{ field, dir string }{
		{"", "asc"}, {"", "desc"},
		{"kind", "asc"}, {"kind", "desc"},
		{"namespace", "asc"}, {"namespace", "desc"},
		{"name", "asc"}, {"name", "desc"},
		{"age", "asc"}, {"age", "desc"},
		{"creationtimestamp", "asc"}, {"creationtimestamp", "desc"},
	}

	// Namespace filter dimension: none, a single namespace, multiple namespaces, the
	// cluster bucket, and cluster + a namespace.
	namespaceFilters := [][]string{
		nil,
		{"default"},
		{"default", "app"},
		{"cluster"},
		{"cluster", "kube-system"},
	}

	// GVK filter dimension: none, single kind, multi-kind, a cluster-scoped kind, a
	// custom kind, and a no-match kind. Kind filters use the catalog's candidate-key
	// matching.
	kindFilters := [][]string{
		nil,
		{"Pod"},
		{"Pod", "Service"},
		{"Node"},
		{"Widget"},
		{"DoesNotExist"},
	}

	// Search dimension: empty (match-all), a >=3-char stem that hits many rows, a short
	// (<3-char) substring, a namespace substring, a kind substring, and a no-match term.
	searches := []string{"", "alpha", "sv", "kube", "config", "zzz-nomatch"}

	pageSizes := []int{3, 7}

	for _, seed := range seeds {
		rng := rand.New(rand.NewSource(seed))
		universe := generateOracleObjects(rng, 200)
		svc := newEquivalenceService(t, universe)

		for _, s := range sorts {
			for _, nsFilter := range namespaceFilters {
				for _, kindFilter := range kindFilters {
					for _, search := range searches {
						for _, limit := range pageSizes {
							opts := QueryOptions{
								SortField:     s.field,
								SortDirection: s.dir,
								Namespaces:    nsFilter,
								Kinds:         kindFilter,
								Search:        search,
								Limit:         limit,
							}
							label := fmt.Sprintf(
								"seed=%d sort=%s/%s ns=%v kinds=%v search=%q limit=%d",
								seed, s.field, s.dir, nsFilter, kindFilter, search, limit,
							)

							// Brute-force oracle: filter + sort the in-memory universe.
							expected := oracleFilterAndSort(universe, opts)
							expectedUIDs := make([]string, len(expected))
							for i, item := range expected {
								expectedUIDs[i] = catalogEngineUID(item)
							}
							wantUnfiltered := oracleUnfilteredCount(universe, false)

							// Engine: page-walk to exhaustion.
							gotUIDs, gotTotal, gotUnfiltered := walkEngine(t, svc, opts, label)

							// Full ordered identity sequence must match the oracle exactly.
							if !equalStrings(gotUIDs, expectedUIDs) {
								t.Fatalf("%s: engine order != oracle order\n want(%d)=%v\n got(%d)=%v",
									label, len(expectedUIDs), expectedUIDs, len(gotUIDs), gotUIDs)
							}

							// Pagination is complete: exactly every matching object, once.
							if gotTotal != len(expectedUIDs) {
								t.Fatalf("%s: TotalItems=%d but oracle matched %d", label, gotTotal, len(expectedUIDs))
							}
							if len(gotUIDs) != len(expectedUIDs) {
								t.Fatalf("%s: page-walk returned %d rows, oracle matched %d (gap or duplicate)",
									label, len(gotUIDs), len(expectedUIDs))
							}

							// Reported unfiltered scope total must equal the oracle count.
							if gotUnfiltered != wantUnfiltered {
								t.Fatalf("%s: UnfilteredTotal=%d, oracle unfiltered count=%d",
									label, gotUnfiltered, wantUnfiltered)
							}
						}
					}
				}
			}
		}
	}
}
