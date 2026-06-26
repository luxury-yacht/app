package snapshot

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// querypageSchemaFromAdapter derives a querypage Schema for a typed table from its
// existing typed-table adapter. It REUSES the adapter's exact comparable sort-value
// encoder (typedTableComparableSortValue) and row key (adapter.Key), so the
// querypage engine orders rows byte-identically to the live typed-table executor —
// the precondition for an invisible cutover. Facet extractors lower/trim to match
// the live matcher's namespace/kind set membership.
func querypageSchemaFromAdapter[T any](adapter typedTableQueryAdapter[T], sortFields []string) querypage.Schema[T] {
	sortKeys := make(map[string]func(T) string, len(sortFields))
	for _, f := range sortFields {
		field := f
		sortKeys[field] = func(row T) string {
			return typedTableComparableSortValue(row, field, adapter)
		}
	}
	return querypage.Schema[T]{
		UID:      adapter.Key,
		SortKeys: sortKeys,
		Facets: map[string]func(T) string{
			"kind":      func(r T) string { return strings.ToLower(strings.TrimSpace(adapter.Kind(r))) },
			"namespace": func(r T) string { return strings.ToLower(strings.TrimSpace(adapter.Namespace(r))) },
		},
		// Join with NUL: the live search is "any SearchText element contains the
		// needle"; a NUL separator makes a single Contains equivalent because no real
		// needle contains NUL, so a match can never span the boundary.
		SearchText: func(row T) string {
			return strings.Join(adapter.SearchText(row), "\x00")
		},
	}
}

func lowerTrimAll(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if v := strings.ToLower(strings.TrimSpace(s)); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// typedQuerySignature pins a cursor to its query shape so a cursor issued for one
// filter/sort/predicate set can never mispage a different one (it is rejected →
// CursorInvalid). It folds every request field that changes the matched set —
// namespaces, kinds, search, and predicates — into a stable string, sorting each
// list so map/slice ordering can never perturb the signature. The leading
// sort/dir/limit and the trailing search segment are written byte-identically to
// the original filter-map form, so a cursor minted before predicates were folded
// in (no namespaces/kinds/predicates present) still validates unchanged.
func typedQuerySignature(sortField string, dir querypage.Direction, limit int, request ResourceQueryRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s|%s|%d|", sortField, dir, limit)
	// Mirror the historical sorted-key filter map: emit "kind=" before "namespace="
	// only when the corresponding list is non-empty, so an empty filter set produces
	// no segment at all (byte-identical to the pre-predicate signature).
	if v := lowerTrimAll(request.Kinds); len(v) > 0 {
		sort.Strings(v)
		b.WriteString("kind=")
		b.WriteString(strings.Join(v, ","))
		b.WriteByte(';')
	}
	if v := lowerTrimAll(request.Namespaces); len(v) > 0 {
		sort.Strings(v)
		b.WriteString("namespace=")
		b.WriteString(strings.Join(v, ","))
		b.WriteByte(';')
	}
	if preds := typedQueryPredicateSignatureParts(request.Predicates); len(preds) > 0 {
		b.WriteString("predicates=")
		b.WriteString(strings.Join(preds, ","))
		b.WriteByte(';')
	}
	b.WriteString("search=")
	b.WriteString(strings.ToLower(strings.TrimSpace(request.Search)))
	return b.String()
}

// typedQueryPredicateSignatureParts encodes each predicate as "Field|Op|Value" and
// sorts them so the signature is independent of predicate order. Predicates narrow
// the matched set, so two queries that differ only in predicates must not share a
// cursor.
func typedQueryPredicateSignatureParts(predicates []ResourceQueryPredicate) []string {
	if len(predicates) == 0 {
		return nil
	}
	parts := make([]string, 0, len(predicates))
	for _, p := range predicates {
		parts = append(parts, fmt.Sprintf("%s|%s|%s", p.Field, p.Op, p.Value))
	}
	sort.Strings(parts)
	return parts
}

// applyTypedTableQueryViaStore answers a typed table query through the querypage
// engine instead of the bespoke per-query sort. It produces the SAME
// typedTableQueryPage as applyTypedTableQuery: identical rows/order/pagination (the
// engine matches the live total order exactly), and identical facets/totals
// (computed by the same matcher + facet collector). The continue token is the
// engine's own opaque cursor — opaque to the frontend, which only round-trips it.
func applyTypedTableQueryViaStore[T any](items []T, query typedTableQuery, adapter typedTableQueryAdapter[T], schema querypage.Schema[T]) typedTableQueryPage[T] {
	if !query.Enabled {
		return applyTypedTableQuery(items, query, adapter)
	}

	// Apply the FULL live matcher first — namespace + kind + search + predicates —
	// so the engine sees only the matched set. Building the store from `matched`
	// (rather than all items and re-filtering inside Query) is what makes the engine
	// honor predicates: the engine's Filters/Search cover only its facet dimensions,
	// not the adapter's predicate function, so a predicate the engine never sees must
	// already have been excluded here.
	matcher := newTypedTableQueryMatcher(query, adapter)
	matched := make([]T, 0, len(items))
	for _, it := range items {
		if matcher.Matches(it) {
			matched = append(matched, it)
		}
	}

	store := querypage.NewStore(schema)
	for _, it := range matched {
		store.Upsert(it)
	}

	sortField := strings.ToLower(strings.TrimSpace(query.Request.SortField))
	if _, ok := schema.SortKeys[sortField]; !ok {
		sortField = "name"
	}
	dir := querypage.Ascending
	if strings.EqualFold(query.Request.SortDirection, "desc") {
		dir = querypage.Descending
	}
	limit := query.Request.Limit
	sig := typedQuerySignature(sortField, dir, limit, query.Request)

	token := ""
	cursorInvalid := false
	if query.Request.Continue != "" {
		if cur, err := querypage.Decode(query.Request.Continue); err != nil ||
			cur.Validate(query.Request.ClusterID, sig, sortField, dir, limit) != nil {
			cursorInvalid = true
		} else {
			token = query.Request.Continue
		}
	}

	// The store already holds only matched rows, so Query needs Sort/Direction/
	// Limit/Cursor only — no Filters/Search (they were applied by the matcher).
	page, _ := store.Query(querypage.Query{
		ClusterID: query.Request.ClusterID,
		Signature: sig,
		Sort:      sortField,
		Direction: dir,
		Limit:     limit,
		Cursor:    token,
	})

	return typedTableQueryPage[T]{
		Rows:            page.Rows,
		Continue:        page.NextCursor,
		CursorInvalid:   cursorInvalid,
		Total:           len(matched),
		UnfilteredTotal: len(items),
		TotalIsExact:    true,
		FacetsExact:     true,
		Namespaces:      collectTypedTableFacet(matched, adapter.Namespace),
		Kinds:           collectTypedTableFacet(matched, adapter.Kind),
		Dynamic:         query.dynamicRef(),
		SortField:       query.Request.SortField,
	}
}

// maintainedScopeBase builds the querypage facet filters that pin a maintained
// store query to THIS request's visible scope: the available kinds for the request
// (optionally intersected with the user's kind filter) and, for a namespaced domain,
// the namespace (optionally intersected with the user's namespace filter). All values
// are lowered+trimmed to match the schema's facet extractor, which lowers+trims too.
//
// userKinds/userNamespaces are the request's kind/namespace filters. When a user list
// is empty the scope is just the available kinds / the domain namespace; when it is
// non-empty the effective filter is the intersection (AND), exactly as the live
// matcher applies namespace AND kind. An intersection that is empty yields a filter
// that matches nothing, mirroring the matcher rejecting every row.
func maintainedScopeBase(availableKinds map[string]bool, namespace string, userKinds, userNamespaces []string, includeUser bool) map[string][]string {
	base := map[string][]string{}

	available := make([]string, 0, len(availableKinds))
	for kind, ok := range availableKinds {
		if ok {
			available = append(available, strings.ToLower(strings.TrimSpace(kind)))
		}
	}
	base["kind"] = available
	if includeUser {
		if uk := lowerTrimAll(userKinds); len(uk) > 0 {
			base["kind"] = intersectLowered(available, uk)
		}
	}

	if namespace != "" {
		base["namespace"] = []string{strings.ToLower(strings.TrimSpace(namespace))}
		if includeUser {
			if un := lowerTrimAll(userNamespaces); len(un) > 0 {
				base["namespace"] = intersectLowered(base["namespace"], un)
			}
		}
	} else if includeUser {
		if un := lowerTrimAll(userNamespaces); len(un) > 0 {
			base["namespace"] = un
		}
	}
	return base
}

// intersectLowered returns the values in `a` that also appear in `b` (both already
// lowered+trimmed). An empty result is preserved as a non-nil empty slice so the
// caller can distinguish "no values, match nothing" from "no filter".
func intersectLowered(a, b []string) []string {
	allow := make(map[string]struct{}, len(b))
	for _, v := range b {
		allow[v] = struct{}{}
	}
	out := make([]string, 0, len(a))
	for _, v := range a {
		if _, ok := allow[v]; ok {
			out = append(out, v)
		}
	}
	return out
}

// maintainedFacetValues maps a Scope facet count map (keyed by the schema's
// lowered+trimmed facet value) back to the original-cased display facet list,
// byte-identically to collectTypedTableFacet over the matched rows. casing maps a
// lowered facet value to the original-cased value the rows carry; a value absent from
// it (e.g. a namespace, already lowercase) is displayed as-is. Empty/"—" values are
// dropped to match addTypedTableFacetValue.
func maintainedFacetValues(counts map[string]int, casing map[string]string) []string {
	out := make([]string, 0, len(counts))
	for value := range counts {
		display := value
		if original, ok := casing[value]; ok {
			display = original
		}
		display = strings.TrimSpace(display)
		if display == "" || display == "—" {
			continue
		}
		out = append(out, display)
	}
	sort.Strings(out)
	return out
}

// resolveMaintainedDirect serves a typed-table query (or window) straight from the
// persistent maintained store, querying it in place (O(log N + page)) instead of
// snapshotting every row and rebuilding a fresh per-Build store. Its output is
// byte-identical to resolveTypedSnapshotPageViaStore(domain, store.rows(namespace,
// availableKinds), …): same page rows/order, Total (matched count), UnfilteredTotal
// (in-scope rows before the user's filters/search), facet value lists, and cursor.
//
// The kind facet list is mapped back to original casing from availableKinds (whose
// keys are the original-cased Kind the rows carry — the descriptor identity), so it
// matches collectTypedTableFacet's output without reconstructing the matched rows.
func resolveMaintainedDirect[T any](
	store *querypage.Store[T],
	query typedTableQuery,
	availableKinds map[string]bool,
	namespace string,
	adapter typedTableQueryAdapter[T],
	schema querypage.Schema[T],
	capabilities ResourceQueryCapabilities,
	windowLimit int,
	windowNoun string,
	kindOf func(T) string,
	windowRows func() []T,
	issues []ResourceQueryIssue,
) typedSnapshotPage[T] {
	if !query.Enabled {
		// Window mode reproduces the truncated, domain-sorted local window exactly via
		// the existing path. windowRows supplies the scope-filtered rows already in the
		// domain's canonical sort order (the same order the list path produces), so the
		// truncated window is byte-identical. This runs only off the paged hot path.
		return resolveTypedSnapshotPageViaStore(
			query.Request.Table, windowRows(), query, adapter, schema,
			capabilities, windowLimit, windowNoun, kindOf, issues,
		)
	}

	sortField := strings.ToLower(strings.TrimSpace(query.Request.SortField))
	if _, ok := schema.SortKeys[sortField]; !ok {
		sortField = "name"
	}
	dir := querypage.Ascending
	if strings.EqualFold(query.Request.SortDirection, "desc") {
		dir = querypage.Descending
	}
	limit := query.Request.Limit
	sig := typedQuerySignature(sortField, dir, limit, query.Request)
	searchLower := strings.ToLower(strings.TrimSpace(query.Request.Search))

	token := ""
	cursorInvalid := false
	if query.Request.Continue != "" {
		if cur, err := querypage.Decode(query.Request.Continue); err != nil ||
			cur.Validate(query.Request.ClusterID, sig, sortField, dir, limit) != nil {
			cursorInvalid = true
		} else {
			token = query.Request.Continue
		}
	}

	// The page query honors the request's full visible scope (available ∩ user kinds,
	// namespace ∩ user namespaces) plus search, walking the FULL sort index and
	// skipping non-matching rows. Because the matched rows keep their relative order in
	// the full index, the page rows, order, and boundary cursor are identical to a
	// matched-only store queried with no filters.
	pageBase := maintainedScopeBase(availableKinds, namespace, query.Request.Kinds, query.Request.Namespaces, true)
	page, _ := store.Query(querypage.Query{
		ClusterID: query.Request.ClusterID,
		Signature: sig,
		Sort:      sortField,
		Direction: dir,
		Limit:     limit,
		// Request.Search is already trimmed at parse time (resourceQueryRequestFromValues);
		// Query lowercases internally, matching the live matcher's needle exactly.
		Search:  query.Request.Search,
		Filters: pageBase,
		Cursor:  token,
	})

	// Facets + Total are over the user-matched set (page query's scope). UnfilteredTotal
	// is over the scope-only set (available kinds + namespace, NO user filters/search) —
	// the count of in-scope rows the list path passed in as `items`.
	matchedFacets, matchedTotal := store.Scope(pageBase, searchLower)
	scopeOnlyBase := maintainedScopeBase(availableKinds, namespace, nil, nil, false)
	_, unfilteredTotal := store.Scope(scopeOnlyBase, "")

	// availableKinds keys are the original-cased Kind the rows carry (the descriptor
	// identity), so lowered facet value -> original casing for the kind facet list.
	kindCasing := make(map[string]string, len(availableKinds))
	for kind := range availableKinds {
		kindCasing[strings.ToLower(strings.TrimSpace(kind))] = kind
	}

	resultPage := typedTableQueryPage[T]{
		Rows:            page.Rows,
		Continue:        page.NextCursor,
		CursorInvalid:   cursorInvalid,
		Total:           matchedTotal,
		UnfilteredTotal: unfilteredTotal,
		TotalIsExact:    true,
		FacetsExact:     true,
		Namespaces:      maintainedFacetValues(matchedFacets["namespace"], nil),
		Kinds:           maintainedFacetValues(matchedFacets["kind"], kindCasing),
		Dynamic:         query.dynamicRef(),
		SortField:       query.Request.SortField,
	}
	return typedSnapshotPage[T]{
		Envelope: typedQueryEnvelope(query.Request.Table, resultPage, capabilities).withDegraded(len(issues) == 0, issues),
		Rows:     resultPage.Rows,
		Stats:    refresh.SnapshotStats{ItemCount: len(resultPage.Rows)},
	}
}

// resolveTypedSnapshotPageViaStore mirrors resolveTypedSnapshotPage but serves the
// query branch through the querypage engine. The window branch and all envelope
// wiring are unchanged, so the snapshot payload is byte-identical apart from the
// opaque continue token.
func resolveTypedSnapshotPageViaStore[T any](
	domain string,
	rows []T,
	query typedTableQuery,
	adapter typedTableQueryAdapter[T],
	schema querypage.Schema[T],
	capabilities ResourceQueryCapabilities,
	windowLimit int,
	windowNoun string,
	kindOf func(T) string,
	issues []ResourceQueryIssue,
) typedSnapshotPage[T] {
	if query.Enabled {
		page := applyTypedTableQueryViaStore(rows, query, adapter, schema)
		return typedSnapshotPage[T]{
			Envelope: typedQueryEnvelope(domain, page, capabilities).withDegraded(len(issues) == 0, issues),
			Rows:     page.Rows,
			Stats:    refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}
	}
	window, totalItems := truncateSnapshotWindow(rows, windowLimit)
	exact := totalItems == len(window) && len(issues) == 0
	return typedSnapshotPage[T]{
		Envelope: typedWindowEnvelope(domain, totalItems, exact, snapshotSortedKinds(window, kindOf), capabilities).withIssues(issues),
		Rows:     window,
		Stats:    snapshotWindowStats(len(window), totalItems, windowNoun),
	}
}

// maintainedUnwrap resolves a possible cache.DeletedFinalStateUnknown tombstone to
// the underlying object so delete handlers can read its identity.
func maintainedUnwrap(obj interface{}) interface{} {
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		return tombstone.Obj
	}
	return obj
}

// typedMaintainedStore is a per-cluster, informer-fed view of a typed table's rows.
// A kind's event handlers project each object into a row of type T and
// Upsert/Delete it here, so the snapshot builder can serve rows straight from RAM
// (scope-filtered) instead of listing + re-projecting every request. It also tracks
// the max resourceVersion seen, for the snapshot's refetch identity.
//
// Correctness rests on the querypage engine's fuzz-proven incremental maintenance
// (store_property_test.go) and on registering the handlers before the informer
// factory starts, so the sync gate guarantees the store is populated before serve.
type typedMaintainedStore[T any] struct {
	store   *querypage.Store[T]
	meta    ClusterMeta
	adapter typedTableQueryAdapter[T]

	mu      sync.Mutex
	version uint64

	// reconcileSources are the shared-informer-fed (and bespoke-informer-fed) feeds whose
	// rows this store holds. Each lists its currently-live rows and reports which existing
	// rows it owns, so Reconcile diff-syncs the store against them: a row restored from a
	// stale spill (warm-paint on re-warm) for an object deleted while the cluster was Cold
	// is dropped — a fresh informer delivers no Delete for it. Ingest-fed kinds are NOT
	// listed here: their reflector's initial Replace already reconciles deletions, so adding
	// them would let Reconcile delete live rows it has no live-set for.
	reconcileSources []maintainedReconcileSource[T]
}

// maintainedReconcileSource is one feed's reconcile contract: listRows returns its
// currently-live projected rows, and owns reports whether an existing store row belongs to
// it — so Reconcile sweeps only the rows this feed is responsible for (a single feed in a
// multi-kind store owns just its kind; a bespoke single-kind store's feed owns all rows).
type maintainedReconcileSource[T any] struct {
	listRows func() []T
	owns     func(T) bool
}

func newTypedMaintainedStore[T any](meta ClusterMeta, schema querypage.Schema[T], adapter typedTableQueryAdapter[T]) *typedMaintainedStore[T] {
	return &typedMaintainedStore[T]{
		store:   querypage.NewStore(schema),
		meta:    meta,
		adapter: adapter,
	}
}

// descriptorInformer resolves a descriptor to its informer from whichever factory
// it uses: the shared factory (most kinds) or the Gateway-API factory (Gateway-API
// kinds). It returns nil when the descriptor has no informer for an available
// factory, so the caller skips registering a handler for it.
func descriptorInformer(d streamspec.Descriptor, factory informers.SharedInformerFactory, gatewayFactory gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
	if d.Informer != nil && factory != nil {
		return d.Informer(factory)
	}
	if d.GatewayInformer != nil && gatewayFactory != nil {
		return d.GatewayInformer(gatewayFactory)
	}
	return nil
}

// streamDescriptorIngestOwned reports whether a stream descriptor's kind is cut over
// to the owned-reflector ingest path (the registry's IngestOwned facet). A cut kind's
// maintained-store feed comes from the ingest Sink, not a shared-informer handler, so
// the handler-registration loop skips it to avoid double-feeding the store.
func streamDescriptorIngestOwned(d streamspec.Descriptor) bool {
	_, owned := kindregistry.IngestOwnedGVRs()[d.GVR()]
	return owned
}

// registerMaintainedHandlers wires the maintained store's ingest/evict into each of
// the domain's registered kinds' informers — generic over the domain's kinds, with
// no per-kind branch. It loops the stream descriptor registry, skipping any kind
// whose indexer was not registered (collectIndexer returns nil), whose informer is
// unavailable (descriptorInformer returns nil), or that is ingest-owned (fed by the
// ingest Sink instead — see feedMaintainedFromIngest). Handlers are registered BEFORE
// the factory starts, so the snapshot sync gate guarantees the store is populated
// before the first Build serves from it.
func registerMaintainedHandlers[T any](
	maintained *typedMaintainedStore[T],
	domainName string,
	collectIndexer func(streamspec.Descriptor) cache.Indexer,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
) error {
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		if streamDescriptorIngestOwned(d) {
			continue
		}
		if collectIndexer(d) == nil {
			continue
		}
		inf := descriptorInformer(d, factory, gatewayFactory)
		if inf == nil {
			continue
		}
		desc := d
		if _, err := inf.AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { maintained.ingest(desc, obj) },
			UpdateFunc: func(_, newObj interface{}) { maintained.ingest(desc, newObj) },
			DeleteFunc: func(obj interface{}) { maintained.evict(desc, obj) },
		}); err != nil {
			return fmt.Errorf("%s: register %s handler: %w", domainName, d.Resource, err)
		}
		// This shared-informer kind gets no Delete on a fresh informer for an object removed
		// while the cluster was Cold, so a row restored from a stale spill would ghost. Record
		// the informer's live-list so reconcile() can diff-sync this kind on re-warm. inf is a
		// per-iteration block-local, so the closure captures this descriptor's informer.
		maintained.addReconcileSource(desc, func() []interface{} { return inf.GetIndexer().List() })
	}
	return nil
}

// registerMaintainedInformerHandler feeds a maintained store from an arbitrary informer
// via a projection closure, for a kind whose informer registerMaintainedHandlers cannot
// reach — its descriptorInformer only resolves shared- and Gateway-factory StreamDescriptor
// informers, so a kind on the apiext factory (CRDs) or one projected outside the StreamRow
// contract (events) needs this. project turns a watched object into its row + source object
// (ok=false skips it). Handlers must be registered before the informer's factory starts so
// the sync gate guarantees the store is populated before the first Build serves from it.
func registerMaintainedInformerHandler[T any](
	maintained *typedMaintainedStore[T],
	informer cache.SharedIndexInformer,
	project func(obj interface{}) (row T, source metav1.Object, ok bool),
) error {
	_, err := informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if row, src, ok := project(obj); ok {
				maintained.upsertRow(row, src)
			}
		},
		UpdateFunc: func(_, newObj interface{}) {
			if row, src, ok := project(newObj); ok {
				maintained.upsertRow(row, src)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if row, _, ok := project(maintainedUnwrap(obj)); ok {
				maintained.deleteRow(row)
			}
		},
	})
	if err != nil {
		return err
	}
	// This bespoke single-kind store gets no Delete on a fresh informer for an object removed
	// while the cluster was Cold, so a row restored from a stale spill would ghost. Register a
	// reconcile source that re-projects the informer's live set and owns the whole store (it
	// holds exactly this one kind), so Reconcile drops ghosts on re-warm.
	maintained.addReconcileSourceRows(
		func() []T {
			objs := informer.GetIndexer().List()
			rows := make([]T, 0, len(objs))
			for _, obj := range objs {
				if row, _, ok := project(obj); ok {
					rows = append(rows, row)
				}
			}
			return rows
		},
		func(T) bool { return true },
	)
	return nil
}

// feedMaintainedFromIngest wires each ingest-owned kind in the domain to feed the
// maintained store from the owned-reflector path: the kind's ingest store delivers its
// whole projected bundle to the store's BundleSink (Table half on upsert, Catalog-half key
// on delete), replacing the shared-informer event handler entirely. It is the per-kind
// equivalent of the quotas all-cut feed, so a domain with a mix of cut and uncut kinds feeds
// the cut ones here and the uncut ones through registerMaintainedHandlers. ingestManager may
// be nil (no cut kinds wired, e.g. a unit test), in which case it is a no-op.
func feedMaintainedFromIngest[T any](
	maintained *typedMaintainedStore[T],
	domainName string,
	ingestManager *ingest.IngestManager,
) {
	if ingestManager == nil {
		return
	}
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		if !streamDescriptorIngestOwned(d) {
			continue
		}
		ingestManager.AddBundleSink(d.GVR(), maintained.bundleSinkFor(d))
	}
}

// BundleSink returns an ingest.BundleSink that feeds this maintained store from the owned
// reflector path with the WHOLE projected bundle. UpsertBundle upserts the bundle's Table
// half (present at upsert) by the adapter's own key; DeleteBundle evicts by the key derived
// from the bundle's RETAINED Catalog half (keyFromCatalog) — the store no longer keeps the
// Table half on its stored bundles, so the delete cannot read it from there. This is the
// live cutover path used in production via AddBundleSink. Mutating advances the snapshot
// version monotonically so refetch identity changes whenever the served set changes.
func (m *typedMaintainedStore[T]) BundleSink() ingest.BundleSink {
	return maintainedStoreSink[T]{store: m}
}

// bundleSinkFor returns the production ingest sink for one descriptor source. Its
// bulk ReplaceBundles path sweeps only rows whose adapter kind belongs to that
// descriptor, so one GVR relist cannot remove another kind's rows in a multi-kind
// maintained store.
func (m *typedMaintainedStore[T]) bundleSinkFor(desc streamspec.Descriptor) ingest.BundleSink {
	return maintainedStoreSink[T]{
		store: m,
		owns:  func(row T) bool { return m.adapter.Kind(row) == desc.Kind },
	}
}

// Sink returns the Table-half ingest.Sink view of the same maintained-store feed. It is the
// delivery path used by the equivalence/maintained-store gate tests, which feed projected
// Table rows directly. Production registers BundleSink() instead, because a dropped-Table
// store's incremental delete must key off the Catalog half, not the (absent) Table row.
func (m *typedMaintainedStore[T]) Sink() ingest.Sink {
	return maintainedStoreSink[T]{store: m}
}

// maintainedStoreSink adapts a typedMaintainedStore to BOTH ingest.Sink (Table-half view,
// used by gate tests) and ingest.BundleSink (whole-bundle view, used in production). The
// reflector store delivers a row/bundle as interface{}; a row of the wrong type is ignored
// (it cannot belong to this store), mirroring the type guard in ingest.
type maintainedStoreSink[T any] struct {
	store *typedMaintainedStore[T]
	owns  func(T) bool
}

func (s maintainedStoreSink[T]) Upsert(tableRow interface{}) {
	row, ok := tableRow.(T)
	if !ok {
		return
	}
	s.store.store.Upsert(row)
	s.store.bumpSinkVersion()
}

func (s maintainedStoreSink[T]) Delete(tableRow interface{}) {
	row, ok := tableRow.(T)
	if !ok {
		return
	}
	s.store.store.Delete(s.store.adapter.Key(row))
	s.store.bumpSinkVersion()
}

func (s maintainedStoreSink[T]) Replace(tableRows []interface{}) {
	rows := make([]T, 0, len(tableRows))
	for _, tableRow := range tableRows {
		row, ok := tableRow.(T)
		if !ok {
			continue
		}
		rows = append(rows, row)
	}
	s.replaceRows(rows)
}

// UpsertBundle upserts the bundle's Table half by the adapter key. The Table half is present
// at upsert (it is dropped from the STORED bundle only AFTER fanning to sinks), so a missing
// or wrong-typed Table half means this bundle does not belong to this store and is ignored.
func (s maintainedStoreSink[T]) UpsertBundle(bundle ingest.Bundle) {
	row, ok := bundle.Table.(T)
	if !ok {
		return
	}
	s.store.store.Upsert(row)
	s.store.bumpSinkVersion()
}

func (s maintainedStoreSink[T]) ReplaceBundles(bundles []ingest.Bundle) {
	rows := make([]T, 0, len(bundles))
	for _, bundle := range bundles {
		row, ok := bundle.Table.(T)
		if !ok {
			continue
		}
		rows = append(rows, row)
	}
	s.replaceRows(rows)
}

// DeleteBundle evicts by the key derived from the bundle's RETAINED Catalog half. A bundle
// with no catalog Summary (a kind with no catalog projector) cannot be keyed this way and is
// ignored — but every ingest-owned maintained-store kind registers a catalog projector, so in
// production the Catalog half is always present (proven for all of them by
// TestKeyFromCatalogMatchesAdapterKeyForEveryMaintainedKind).
func (s maintainedStoreSink[T]) DeleteBundle(bundle ingest.Bundle) {
	summary, ok := bundle.Catalog.(objectcatalog.Summary)
	if !ok {
		return
	}
	s.store.store.Delete(keyFromCatalog(summary))
	s.store.bumpSinkVersion()
}

func (s maintainedStoreSink[T]) replaceRows(rows []T) {
	owns := s.owns
	if owns == nil {
		owns = func(T) bool { return true }
	}
	s.store.store.ReplaceWhere(rows, owns)
	s.store.bumpSinkVersion()
}

// bumpSinkVersion advances the snapshot version by one on every sink mutation.
// The reflector-fed rows carry no resourceVersion, so the maintained store cannot
// reuse resourceVersionOrTimestamp; a per-change counter is an equally valid
// monotonic refetch identity that changes exactly when the served set changes.
func (m *typedMaintainedStore[T]) bumpSinkVersion() {
	m.mu.Lock()
	m.version++
	m.mu.Unlock()
}

// upsertRow ingests an already-projected row directly, bumping the store version
// from the source object's resourceVersion. Domains whose row projection is not
// expressible as the descriptor's StreamRow closure (e.g. pods, whose row carries
// metrics overlaid at serve and a ReplicaSet→Deployment owner collapse) project the
// row themselves and feed it here instead of through ingest.
func (m *typedMaintainedStore[T]) upsertRow(row T, o metav1.Object) {
	m.store.Upsert(row)
	m.bumpVersion(o)
}

// spillTo flushes the store's rows to path in the Tier 2.6 columnar on-disk format (scalar
// columns flat/mmap-friendly, dynamic fields gob'd) so a Cold cluster's heap can be reclaimed
// and the store re-painted fast on re-warm. Only the rows are written; the indexes/facets are
// rebuilt from them on restore.
func (m *typedMaintainedStore[T]) SpillTo(path string) error {
	return m.store.SpillColumns(path)
}

// SwapToMmap spills this store's columns to path and swaps the SAME underlying querypage
// store in place to a read-only, mmap-aliased view of that file — so Build keeps serving from
// m.store (same pointer) but with the bulk column data off-heap (OS-reclaimable page cache),
// the governor's Cold-tier serving transition. It bumps the refetch identity on success so the
// first Build after cooling reflects the cooled (frozen) state. The returned closer unmaps the
// file and MUST be held for the cooled store's lifetime, then called exactly once on
// re-warm/teardown (it is itself idempotent and waits for any in-flight Query). On error the
// store is left unchanged (safe-degrade — the caller falls back to full teardown).
func (m *typedMaintainedStore[T]) SwapToMmap(path string) (func() error, error) {
	closer, err := m.store.ReopenInternedColumnsInPlace(path)
	if err != nil {
		return nil, err
	}
	m.bumpSinkVersion()
	return closer, nil
}

// restoreFrom loads spilled rows from path into this store (warm-paint), then bumps the
// refetch identity so the first Build after re-warm serves the restored rows. It reads the
// columnar format and falls back to the gob format if that fails — handling a spill file
// written by a prior (gob) build during a same-version transition, and degrading safely on
// any columnar parse error. The rows are possibly STALE: reconcile() (shared-informer kinds)
// and the fresh reflectors' initial Replace (ingest kinds) reconcile them once the subsystem
// syncs. A missing spill file (never spilled) is not an error — the store stays empty and the
// normal sync populates it, exactly as a cold start does.
func (m *typedMaintainedStore[T]) RestoreFrom(path string) error {
	if err := m.store.RestoreColumnsFromFileInto(path); err != nil {
		if gobErr := m.store.RestoreFromFile(path); gobErr != nil {
			return err // report the columnar error (the current format); the gob fallback also failed
		}
	}
	m.bumpSinkVersion()
	return nil
}

// addReconcileSource registers a descriptor-fed kind (registerMaintainedHandlers) for
// Reconcile to diff-sync: list yields the kind's currently-live objects (the informer's
// indexer List), which it projects via the descriptor's StreamRow; the source owns only
// rows whose adapter kind equals the descriptor's, so it never sweeps another kind's rows.
func (m *typedMaintainedStore[T]) addReconcileSource(desc streamspec.Descriptor, list func() []interface{}) {
	m.reconcileSources = append(m.reconcileSources, maintainedReconcileSource[T]{
		listRows: func() []T {
			objs := list()
			rows := make([]T, 0, len(objs))
			for _, obj := range objs {
				item, ok := maintainedUnwrap(obj).(metav1.Object)
				if !ok {
					continue
				}
				if row, ok := desc.StreamRow(m.meta, item).(T); ok {
					rows = append(rows, row)
				}
			}
			return rows
		},
		owns: func(r T) bool { return m.adapter.Kind(r) == desc.Kind },
	})
}

// addReconcileSourceRows registers a feed whose rows are produced by a bespoke projection
// (registerMaintainedInformerHandler) rather than a descriptor's StreamRow — the CRD/event
// stores. listRows yields its currently-live rows; owns reports which existing rows it is
// responsible for (a single-kind bespoke store passes owns == always-true to sweep its
// whole content).
func (m *typedMaintainedStore[T]) addReconcileSourceRows(listRows func() []T, owns func(T) bool) {
	m.reconcileSources = append(m.reconcileSources, maintainedReconcileSource[T]{listRows: listRows, owns: owns})
}

// Reconcile diff-syncs the store against the live row set of every reconcile source: it
// re-upserts each live row (idempotent) and deletes any existing row the source OWNS whose
// key is absent from that live set. It is the re-warm correctness step for warm-painted
// rows — a fresh informer delivers no Delete for an object removed while the cluster was
// Cold, so a stale restored row would otherwise persist as a ghost. The owns predicate
// scopes each sweep so a source never touches rows of a kind it has no live-set for
// (ingest-fed kinds, which self-reconcile). A no-op when no reconcile sources are
// registered (a fully ingest-fed store, or a fresh start with nothing restored).
func (m *typedMaintainedStore[T]) Reconcile() {
	if len(m.reconcileSources) == 0 {
		return
	}
	for _, src := range m.reconcileSources {
		want := make(map[string]struct{})
		for _, row := range src.listRows() {
			want[m.adapter.Key(row)] = struct{}{}
			m.store.Upsert(row)
		}
		for _, existing := range m.store.Snapshot() {
			if !src.owns(existing) {
				continue
			}
			key := m.adapter.Key(existing)
			if _, keep := want[key]; !keep {
				m.store.Delete(key)
			}
		}
	}
	// Reconcile runs only on re-warm (ReconcileMaintainedStores); a refetch is always
	// wanted then, so advance the refetch identity once.
	m.bumpSinkVersion()
}

// deleteRow removes an already-projected row by its adapter key — the bespoke-projection
// counterpart of evict (which derives the row from a StreamRow descriptor). Like evict it
// does NOT bump the version: an RV-based store's version is the max resourceVersion seen,
// which a delete never raises, and the list path's version behaves the same — so the
// maintained and list versions stay in agreement.
func (m *typedMaintainedStore[T]) deleteRow(row T) {
	m.store.Delete(m.adapter.Key(row))
}

// ingest projects an added/updated object via the descriptor's StreamRow closure
// and upserts it — generic over the domain's kinds, no per-kind branch.
func (m *typedMaintainedStore[T]) ingest(d streamspec.Descriptor, obj interface{}) {
	item, ok := maintainedUnwrap(obj).(metav1.Object)
	if !ok {
		return
	}
	row, ok := d.StreamRow(m.meta, item).(T)
	if !ok {
		return
	}
	m.store.Upsert(row)
	m.bumpVersion(item)
}

// evict removes a deleted object by its row key. It projects the object via the
// descriptor's StreamRow closure and derives the key through the adapter's own Key
// function — the SAME key Upsert stored it under — so namespaced and cluster-scoped
// domains (which key rows differently) both delete correctly, with no per-kind branch.
func (m *typedMaintainedStore[T]) evict(d streamspec.Descriptor, obj interface{}) {
	item, ok := maintainedUnwrap(obj).(metav1.Object)
	if !ok {
		return
	}
	row, ok := d.StreamRow(m.meta, item).(T)
	if !ok {
		return
	}
	m.store.Delete(m.adapter.Key(row))
}

func (m *typedMaintainedStore[T]) bumpVersion(o metav1.Object) {
	v := resourceVersionOrTimestamp(o)
	if v == 0 {
		return
	}
	m.mu.Lock()
	if v > m.version {
		m.version = v
	}
	m.mu.Unlock()
}

func (m *typedMaintainedStore[T]) snapshotVersion() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.version
}

// rows returns the maintained rows for a namespace ("" = all namespaces), restricted
// to the kinds available for THIS request — mirroring the list path's per-request
// runtimeResourceAllowed gating so the two produce the same set.
func (m *typedMaintainedStore[T]) rows(namespace string, availableKinds map[string]bool) []T {
	all := m.store.Snapshot()
	out := make([]T, 0, len(all))
	for _, row := range all {
		if !availableKinds[m.adapter.Kind(row)] {
			continue
		}
		if namespace != "" && m.adapter.Namespace(row) != namespace {
			continue
		}
		out = append(out, row)
	}
	return out
}

// rowsInNamespace returns the maintained rows for a namespace ("" = all namespaces),
// filtering by namespace ONLY. It serves open-kind-set domains (events) whose adapter.Kind
// is the involved-object kind, not a fixed domain kind — so the rows() availableKinds gate
// cannot enumerate the kinds and would wrongly drop every row.
func (m *typedMaintainedStore[T]) rowsInNamespace(namespace string) []T {
	all := m.store.Snapshot()
	out := make([]T, 0, len(all))
	for _, row := range all {
		if namespace != "" && m.adapter.Namespace(row) != namespace {
			continue
		}
		out = append(out, row)
	}
	return out
}
