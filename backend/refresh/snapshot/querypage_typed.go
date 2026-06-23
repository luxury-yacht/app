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
	}
	return nil
}

// feedMaintainedFromIngest wires each ingest-owned kind in the domain to feed the
// maintained store from the owned-reflector path: the kind's ingest store delivers
// its already-projected Table-half row to the store's Sink, replacing the shared-
// informer event handler entirely. It is the per-kind equivalent of the quotas
// all-cut feed, so a domain with a mix of cut and uncut kinds feeds the cut ones here
// and the uncut ones through registerMaintainedHandlers. ingestManager may be nil (no
// cut kinds wired, e.g. a unit test), in which case it is a no-op.
func feedMaintainedFromIngest[T any](
	maintained *typedMaintainedStore[T],
	domainName string,
	ingestManager *ingest.IngestManager,
) {
	if ingestManager == nil {
		return
	}
	sink := maintained.Sink()
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		if !streamDescriptorIngestOwned(d) {
			continue
		}
		ingestManager.AddSink(d.GVR(), sink)
	}
}

// Sink returns an ingest.Sink that feeds this maintained store from the owned
// reflector path: each Upsert/Delete carries the already-projected row (the
// bundle's Table half), which the adapter upserts/evicts by the adapter's own key.
// Mutating through the sink advances the snapshot version monotonically so refetch
// identity changes whenever the served set changes. This is the live cutover path;
// the object-based ingest/evict methods remain for the equivalence gate tests.
func (m *typedMaintainedStore[T]) Sink() ingest.Sink {
	return maintainedStoreSink[T]{store: m}
}

// maintainedStoreSink adapts a typedMaintainedStore to ingest.Sink. The reflector
// store delivers the Table-half row as interface{}; a row of the wrong type is
// ignored (it cannot belong to this store), mirroring the type guard in ingest.
type maintainedStoreSink[T any] struct {
	store *typedMaintainedStore[T]
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

// deleteKey removes a row by its adapter key. Self-projecting domains derive the
// key from their projected row (adapter.Key) and call this directly.
func (m *typedMaintainedStore[T]) deleteKey(key string) {
	m.store.Delete(key)
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
