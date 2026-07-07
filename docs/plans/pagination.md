# Pagination — Anchor Jump + Correctness Overhaul

Two mandates in one plan, sequenced so they reinforce each other:

1. **Anchor jump (the feature).** Reference a specific object and jump directly
   to the page containing it under the table's current sort + filters, object
   at its natural position (first, last, or middle; page size 50 with 300
   matches and rank #137 → the page covering ranks 100–149, object highlighted
   at row 37), then paginate normally in both directions. Rank is never
   stored — it is derived per request under that request's sort + filters,
   exactly like totals and facets, so sort/filter dependence is handled by
   construction.
2. **Correctness overhaul (the debt).** Fix every defect identified in the
   2026-07-06 pagination review: the position-label fiction, the unguarded
   export walk, the dual prev-page mechanisms, the unfinished cursor-codec
   unification, the per-Build rebuild-per-page-turn, the dead cursor contract
   surface, the overselling docs, and the stale frontend comment.

## Problem register (verified 2026-07-06)

Feature gaps (G) and defects (F), each with the phase that resolves it.

| # | Problem | Evidence | Fixed in |
|---|---------|----------|----------|
| G1 | No anchor concept in the query contract | `resource_query_contract.go:59-60`; repo grep for "anchor" over querypage/typed-serve/catalog: zero hits | P3 |
| G2 | Frontend cannot mint cursors (opaque; backend-hashed `Signature`) | `querypage_typed.go:70,153`, `cursor.go:107-116` | P3 (by design — anchor is a request field) |
| G3 | Keyset walk excludes its pivot — a cursor at the object returns the page after it | `store.go:451-453` | P2 |
| G4 | No rank primitive; order-statistics deliberately not built | `store.go:461-472`; `data-layer.md` "Deliberately not built" | P2 |
| G5 | Backward paging cannot start mid-list on typed tables (client token stack) | `useTypedResourceQuery.ts:130,500` | P3+P7 |
| F1 | Footer range label is client fiction — `(pageIndex-1)*pageSize` drifts under churn | `QueryPaginationControls.tsx:70-78`, `useTypedResourceQuery.ts:131` | P2+P9 |
| F2 | No cross-page consistency guard on multi-page walks (export can silently span data generations) | `cursor.go:56-58` Revision never set (grep: zero non-test refs) | P7 |
| F3 | First/prev/next only; no numbered jumps despite exact totals | `large-data.md` "Agent Contract" | P9 |
| F4 | Two executors + two cursor codecs still live; `cursor.go` unification "a separate, later step" never happened | `querypage_typed.go:121-123`, `typed_table_query.go:302,352,430-444`, `cursor.go:3-12` | P5 |
| F5 | Prev-page exists twice with different semantics; backend `PrevCursor` computed then discarded on the typed path | `store.go:493-520,543`; consumed only at `query_engine.go:359`; envelope `Previous` declared but never populated (`resource_query_contract.go:174` — the only `Previous:` writer anywhere is Browse's `catalog.go:215`) | P3+P7 |
| F6 | Per-Build path rebuilds the whole store + b-trees per page turn (cursor rides the scope string, so each turn is a distinct request) | `querypage_typed.go:139-142`, `typedResourceQueryScope.ts:124-125` | P6 |
| F7 | Docs oversell: "facets/totals are O(1) counter reads (exact at any N)" vs the O(N) filtered scan; sparse-filter walks degrade toward O(N) | `data-layer.md` vs `store.go:522-528,450-459` | P0 |
| F8 | Stale comment claims live-data changes drop cursors; the reset identity deliberately excludes `liveDataVersion` | `useTypedResourceQuery.ts:239-241` vs `177-190` | P7 |
| F9 | Dead/unimplemented cursor surface: `Position []string` (only `[0]` read), `Revision` never set; decode errors hard-fail in the engine while validate mismatches restart gracefully | `cursor.go:47-59`, `store.go:412-425` | P1 |
| F10 | Rows with equal sort values order by UID tiebreak — RESOLVED as verified-fine in P1: the "UID" is the name-shaped adapter key (kind/ns/name) / catalog identity chain, so tie order is already human; contract made explicit on `Schema` docs and pinned by `TestTiedSortValuesOrderByHumanKey` | `store.go:46`, `querypage_typed.go:37`, `typed_table_query.go:460-465` | P1 ✅ |
| F11 | Dead contract surface: `ResourceQueryResult` + its TS mirror have zero producers/consumers; the served typed contract is `ResourceQueryEnvelope` | grep 2026-07-06: only the definition (`resource_query_contract.go:69`), the mirror (`types.ts:564`), one contract test | P3 |

Facts the design builds on (verified 2026-07-06):

- All three serve paths funnel into `querypage.Store`: maintained-direct
  (`querypage_typed.go:338`), per-Build (`querypage_typed.go:139-142,168`,
  store built from pre-matched rows at `125-137`), catalog
  (`query_engine.go:283`). One engine primitive covers everything.
- Serve-path census (2026-07-06): maintained-direct = exactly 8 call sites,
  all non-metric domains (config/rbac ×2 each, storage ×2, quotas,
  autoscaling); every metric-joined domain (pods, workloads, nodes) is
  per-Build with its metric overlay applied before the store build. The
  catalog's hot path queries a MAINTAINED engine store
  (`query_engine.go:250-256`); its per-query store rebuild is only the
  no-chunks-published cold-start fallback (`258-262`) — no F6-class waste
  there.
- Filtered totals already pay a full O(N) match-value scan per query
  (`store.go:522-528`); measured pages at 100k–250k rows run 4–18 ms
  (`large-data.md` "Current Browse Budget"). An O(rank) counted walk is the
  same cost class or cheaper.
- The soft reset fires on filter/sort/page-size change and deliberately
  excludes `liveDataVersion` (`useTypedResourceQuery.ts:177-190,243-250`);
  live refetches reuse the current page token (`215-216`); `cursorInvalid`
  resets to page 1 (`381-388`).
- Browse already round-trips backend `previousToken`/`continueToken`
  (`useBrowseCatalog.ts:196-197`) — the typed hook converges on that shape.
- The frontend mirrors the envelope as ONE chokepoint interface —
  `ResourceQueryEnvelopeFields` (`types.ts:596-614`), extended by every typed
  payload — and it already declares `previous?` (`types.ts:601`, dead on both
  sides of the wire today). P3's TS work is: add `anchor`/`pageStartRank` to
  that one interface (+ the CatalogSnapshot mirror separately, which
  deliberately doesn't extend it — `types.ts:513`).
- The typed serve path pre-validates cursors and maps decode failures to
  `cursorInvalid` before calling the engine (`querypage_typed.go:157-164`),
  so cursor JSON-shape changes degrade to a graceful page-1 restart.
- In-page focus/scroll machinery exists (`GridTableKeys.ts:23` `jumpToIndex`).
- Byte-identity gates compare store serve to a brute list+project oracle
  (`data-layer.md` "Validation").
- The export-walk consistency clock is verified end-to-end: every snapshot
  carries `SourceVersions` with an `object` clock defaulting to the domain
  build version (`refresh/types.go:111-122`, `service.go:535-541`), which
  advances on EVERY store mutation (`bumpSinkVersion`,
  `querypage_typed.go:743-747`; informer path `908-918`); the walker's
  per-page `requestRefreshDomainState` returns the scoped domain state
  (`dataAccess.ts:132-136`) exposing `sourceVersions` (`store.ts:22`,
  `orchestrator.ts:1341`). **Trap:** the folded `sourceVersion` token embeds
  the scope string (`service.go:544-559`), and export pages have distinct
  scope strings (the continue token rides them) — so a cross-page guard must
  diff the raw `sourceVersions["object"]` clock, never the folded token
  (which differs on every page unconditionally).
- Engine row keys are adapter-owned and name-shaped, not Kubernetes UIDs:
  pods `ns/name` (`pods.go:552-554`), workloads/static tables `kind/ns/name`
  (`namespace_workloads.go:522-524`, `namespacedTableKey`,
  `static_table_query.go:619-621`), cluster tables `kind/name` (`623-625`);
  the catalog key is the identity chain embedding the object UID
  (`query_engine.go:112-116`). Typed summary rows carry NO UID field
  (`streamrows.go:376-410` — all 16 adapters enumerated 2026-07-06).

## Design

### Anchor is a request intent, not a cursor

Cursors stay backend-minted opaque page boundaries. The anchor is a
first-class request field expressing "the page containing this object". The
response mints ordinary keyset cursors, so post-jump pagination is
indistinguishable from pagination that arrived by clicking. No new codec, no
new `Validate` surface, no second engine (data-layer invariant #1).

`ResourceQueryRequest` gains (mutually exclusive with `Continue`; both set is
a validation error):

```go
Anchor *ResourceQueryAnchor `json:"anchor,omitempty"`

type ResourceQueryAnchor struct {
    ClusterID string `json:"clusterId"` // must equal request.ClusterID, else error
    Group     string `json:"group"`
    Version   string `json:"version"`
    Kind      string `json:"kind"`
    Namespace string `json:"namespace,omitempty"`
    Name      string `json:"name"`
    UID       string `json:"uid,omitempty"` // identity cross-check ONLY where the resolved row carries a UID (catalog); never a lookup key — see Anchor resolution
}
```

The result fields land on the structs actually served: `ResourceQueryEnvelope`
(fed via `typedTableQueryPage` → `typedQueryEnvelope`,
`typed_table_query.go:118-135`) and Browse's `CatalogSnapshot` (which
deliberately does NOT embed the envelope — `catalog.go:30-36` — and already
carries `Previous`). **Not** on `ResourceQueryResult` — that struct and its TS
mirror are dead (F11); P3 deletes both. The envelope already declares
`Previous` (`resource_query_contract.go:174`) with no writer — P3 wires it
rather than adding a field.

```go
// ResourceQueryEnvelope (+ typedTableQueryPage plumbing) gains/wires:
Previous      string                     `json:"previous,omitempty"`      // every response (F5); field exists, unpopulated today
Anchor        *ResourceQueryAnchorResult `json:"anchor,omitempty"`        // iff request had one
PageStartRank *int                       `json:"pageStartRank,omitempty"` // P9, benchmark-gated; POINTER: rank 0 (page 1) must stay distinguishable from "not computed" under omitempty

type ResourceQueryAnchorResult struct {
    Found  bool   `json:"found"`
    Rank   int    `json:"rank"`             // 0-based, under THIS request's sort+filters
    Reason string `json:"reason,omitempty"` // "filtered" | "not-found"
}
```

`"filtered"` (exists, excluded by current filters/search) and `"not-found"`
(deleted or identity mismatch) are distinct user-visible truths
(`large-data.md` requires degraded states be visible). A missing anchor
returns the **first page anyway** plus the reason — one round trip, sane
landing.

### Engine: one single-pass walk serves anchor, rank, and offset

`Store.QueryAround(q, anchorKey)` (the resolved store row key — see Anchor
resolution) walks the direction's index from the start in
display order, maintaining a buffer of up to `limit` matching entries (the
current page window), clearing it at each page boundary. When the anchor entry
lands in the buffer, fill to `limit` + one overflow probe and stop. One
O(rank + limit) pass yields the exact 0-based rank, the **page-aligned**
window (`pageStart = rank - rank % limit`), and both boundary rows for
standard `pin()` cursor minting. Page alignment is the placement policy: every
page reached by ◀/▶ afterward is identical to the page reached by paging from
page 1. Centered windows are rejected.

The same counted walk, parameterized by target, also serves:

- **`StartRank` offset pages (F3/P9):** request field usable only while
  `TotalIsExact`; serve = count to `startRank`, collect `limit`. This is the
  "separate bounded offset contract" `large-data.md` gates numbered page
  jumps behind.
- **`PageStartRank` (F1/P9):** rank of the served page's first row, making
  the footer range exact at serve time instead of client-derived.

No order-statistics trees. Measured (P2, 2026-07-06, `BenchmarkStoreQueryAround`):
mid-rank jumps are inside the page-serve budget class (100k: 3.24 ms, 250k:
14.35 ms), the 250k worst-case deep anchor is 33.16 ms — ~2× the worst measured
page serve (b-tree iteration costs more per entry than the flat match scan) —
accepted for a one-shot user-initiated jump and recorded in `large-data.md`.
Order statistics stay parked behind a measured UX regression, same discipline
as the catalog store seam.

### Anchor resolution: serve-layer-owned, engine sees only a row key

`QueryAround` takes the resolved store row key (the schema `UID`), never the
anchor struct — engine row keys are adapter-owned and name-shaped, not
Kubernetes UIDs (see facts). Resolution per provider:

- **Typed:** `typedTableQueryAdapter` grows an
  `AnchorKey(kind, namespace, name string) string` — formulaic, built from the
  same helpers the `Key` funcs use (`namespacedTableKey`/`clusterTableKey`),
  so the serve layer maps anchor identity → row key with no engine change and
  no per-kind branch outside the adapter.
- **Catalog:** look up the `Summary` by (gvr, namespace, name) — the items-map
  key is exactly that base (`query_engine.go:58-59`) — then
  `catalogEngineUID(summary)` yields the engine key.
- **`filtered` vs `not-found`:** maintained/catalog — key present in the store
  but failing the request matcher → `filtered`; key absent → `not-found`.
  Per-Build — the store holds matched rows only, so one matcher check against
  the full item list disambiguates.
- **`UID` cross-check:** catalog Summaries carry the object UID — a mismatch
  reports `not-found` (the object was deleted and recreated). Typed summary
  rows carry NO UID field (`streamrows.go:376-410`), so typed anchors match by
  name-shaped key alone — which is the wanted "show in list" UX anyway (a
  recreated same-name object still lands). Adding UID to typed row types is
  explicitly out of scope.

### Cursor codec diet (F9, F10)

The unified cursor sheds its unimplemented surface instead of growing more:

- **`Position []string` → `Position string`.** The architecture's own
  invariant is one comparable value per row (`large-data.md` "Keyset
  ordering"); the multi-component contract contradicts it and only `[0]` is
  read (`store.go:423-425`). In-flight tokens fail decode after the shape
  change → callers already map that to `cursorInvalid` → page-1 restart
  (`querypage_typed.go:157-164`). Acceptable: tokens are ephemeral.
- **Delete `Revision`.** Never set, never read (grep, zero non-test refs).
  Its intended job — multi-page walk consistency — is served by the raw
  `sourceVersions["object"]` clock the frontend already receives (see
  Export-walk guard below). Dead-code rule applies.
- **Normalize decode-error semantics in the engine.** `Decode` failure
  currently hard-errors (`store.go:412-415`) while `Validate` mismatch
  restarts gracefully (`416-418`). Engine-level: both → graceful first-page
  restart with an invalid-cursor signal, so callers can't diverge.
- **Tie ordering (F10).** Verify what schema sort extractors emit for
  colliding values (same name across namespaces; multi-kind stores). If UID
  ties are user-visible arbitrary ordering, fold the human tiebreak
  (namespace, kind) into the comparable value at the schema level — the
  cursor and index inherit it for free. Position shape change above already
  invalidates in-flight cursors, so both land together. The bespoke executor
  moves in lockstep: both paths share `typedTableComparableSortValue` and the
  adapter-key tiebreak (`typed_table_query.go:266-272` vs the engine schema at
  `querypage_typed.go:28-49`), so the byte-identity gates stay green — but any
  fixture pinning today's tied-row order must be updated in the same slice.

### Executor unification (F4)

End state: **one production executor** — the `querypage` engine; the bespoke
sort path becomes the test oracle it already effectively is.

1. Trace production callers of `applyTypedTableQuery` (the `!query.Enabled`
   early-return at `querypage_typed.go:121-123`) and what of its output the
   window path actually consumes.
2. Route the `!Enabled` window path through the engine (build/serve identical
   to the Enabled path minus query predicates); extend the byte-identity
   gates to window mode to prove equivalence before the switch.
3. Demote `applyTypedTableQuery` + `typedTableQueryCursor` +
   `encode/decodeTypedTableQueryCursor` to test-only oracle code; delete the
   production references.
4. Rewrite the `cursor.go` package doc — the "two codecs, wiring later"
   story (`cursor.go:3-12`) ends here.

### Per-Build store reuse (F6)

`applyTypedTableQueryViaStore` rebuilds the matched set, the columnar store,
and all sort indexes per call — and since the continue token rides the scope
string, every page turn pays O(N log N) to serve one page. Fix: a single-slot
per-(cluster, domain, table) cache keyed by (matched-set identity: filters +
search + predicates + kind/namespace scope, source data version, **and
`DynamicRevision`** — the metric-joined domains overlay serve-time metric
values onto the rows BEFORE the per-Build store is built (`pods.go:291`→`321`,
`namespace_workloads.go:309`, `nodes.go:365`), so a cache that ignores the
metric clock would freeze both metric values and metric SORT ORDER across
ticks; including it caps those domains' cache wins to within-tick page turns,
which is correct). Page turns and sort changes (indexes already built per
schema) hit the cache; any source version bump, metric tick, or filter change
invalidates. Verify interaction with the
existing response cache/invalidation layer before wiring. Memory bound: one
matched-set store per domain, dropped on version bump AND on cluster
teardown/disconnect (per-cluster keyed, lifecycle-owned like the domain's
other state). Churn honesty: the version clock advances on every domain
mutation (`querypage_typed.go:743-747`), so a churning domain misses this
cache on every page turn — no worse than today's rebuild, but the win is
quiet-domain-only. Benchmark page-turn latency on a per-Build domain at 100k
rows before/after, including a churn scenario, and state the quiet-only
scope of the win in the results.

### Export-walk consistency guard (F2)

Paging tolerates drift by design (value-keyed keysets); bulk walks must not
*silently* tolerate it. But the clock is hair-triggered: the `object` source
clock advances on EVERY store mutation (`querypage_typed.go:743-747,908-918`),
so on an actively churning domain (pods on a live cluster) drift across a
multi-page walk is near-certain — a hard failure on drift would make export
unusable exactly where it matters most. Policy: the "all matching rows" walk
(`useQueryBackedResourceGridTable.ts:323-326`, `walkQueryCursorPages`)
snapshots `sourceVersions["object"]` at walk start and compares per page. On
first drift, restart the walk once (a cheap shot at a clean pass). On second
drift, **complete the walk and deliver the export with a user-visible "data
changed during export — rows reflect a mix of before/after states"
annotation**. Loud, not fatal: failed pages keep hard-failing per the existing
CSV/copy rule (`large-data.md`); drift downgrades to a visible warning because
it is honest, frequent under churn, and the keyset walk still yields a
complete-as-of-mixed-times set. Delivery path is verified (see facts): each
page's scoped domain state exposes `sourceVersions`. Compare the raw
`sourceVersions["object"]` clock — NEVER the folded `sourceVersion` token,
which embeds the scope string (`service.go:544-559`) and therefore differs on
every export page unconditionally (distinct continue tokens → distinct
scopes). A churning-domain test is part of the P7 slice.

### Frontend: anchor intent + prev migration

Anchor is navigation state, never persisted table state (favorites must not
replay jumps). Lifecycle:

- **Landing:** seed `pageIndex = floor(rank/limit) + 1`, adopt returned
  `previous`/`continue`, scroll to `rank % limit` via `jumpToIndex`,
  highlight.
- **Live refetches** reuse the current page cursor — the view must not chase
  a moving object (quiet-refetch contract). "Follow this object" is a
  separate future feature.
- **Sort / filter / page-size changes** re-fire the anchor instead of
  bouncing to page 1 — the soft reset re-anchors, so the jump intent
  survives re-sorts. While correcting that code path, fix the stale comment
  (F8).
- **User pagination** clears the intent (deliberately left the context).
- **Missing anchor:** show the reason inline, apply the returned first page,
  clear the intent. **`cursorInvalid` with a held anchor:** retry with the
  anchor, not page 1.

Prev migration (F5): delete the `previousTokens` stack; `hasPrevious` becomes
`Boolean(previousToken)`; ArrowLeft/ArrowRight parity preserved; the
continue-only export walk is unaffected. Typed hook converges on the Browse
shape.

### Entry points

"Show in list" from surfaces holding a full object ref (object panel, related
rows, object map). Rows carry UID in the contract
(`resource_query_contract.go:92`); each entry point's ref completeness is
verified in P8, not assumed.

## Phases

Red/green TDD per repo rule: each slice starts with a failing test. Doc
updates ride the phase that changes the behavior they describe.

- [x] ✅ **P0 — Doc truth (immediate, doc-only).** Correct `data-layer.md`:
  totals/facets are O(1) only for unfiltered queries (filtered = O(N) match
  scan, `store.go:522-528`); document sparse-filter walk degradation. No code.
- [x] ✅ **P1 — Cursor codec diet + store hardening** (2026-07-06; the engine
  additionally absorbed the catalog's backward-dead-end rule so all executors
  share one cursor-degrade contract, and all three callers dropped their
  duplicated pre-validation). `Position` → single
  value; delete `Revision`; engine-level graceful restart on decode failure;
  verify + fix tie ordering (fold human tiebreak into comparable values if
  UID ties are user-visible; both executors share the comparable encoder so
  they move together — update tied-row fixtures in the same slice). Property
  tests pin: token shape change → `cursorInvalid` → page 1; deterministic tie
  order.
- [x] ✅ **P2 — Engine walk** (2026-07-06; `QueryAround` + `QueryAt` +
  `Page.PageStartRank` (-1 on cursor serves) + `AnchorOutcome`; Query's
  matcher/facet-tail/pin extracted as shared helpers; fuzz continuation walks
  prove landings paginate to both ends byte-identically to the oracle;
  benchmarks recorded in `large-data.md`). `Store.QueryAround` + shared counted-walk core
  (anchor target, `startRank` target, page-start rank). Property test vs the
  brute oracle: random stores/filters/sorts/directions/limits/anchors —
  aligned page, exact rank, minted prev/next all match
  sort→filter→index→slice. Edges: first/last page, sole match, absent UID,
  desc, limit 1. Benchmark: anchored jump at 100k/250k alongside the Browse
  budget table.
- [x] ✅ **P3 — Typed contract + serve** (2026-07-06; both engine paths wired,
  16 adapters keyed + consistency-pinned, metric-sort regression test green,
  `ResourceQueryResult`+TS mirror+`ResourceQueryFacets` deleted, envelope
  `Previous` populated everywhere; anchored serves have no bespoke counterpart
  so their oracle is the P2 fuzz + serve tests — cursor-path byte-identity
  gates unchanged and green). `Anchor` request field; wire the
  envelope's existing `Previous` + add `Anchor`/`PageStartRank` **on
  `ResourceQueryEnvelope` via `typedTableQueryPage`** (F5); delete the dead
  `ResourceQueryResult` + its TS mirror (F11); adapter `AnchorKey` +
  serve-layer anchor→row-key resolution (see Anchor resolution); scope-string
  plumbing (anchor params ride the same channel as `continue`);
  mutual-exclusion + cluster-mismatch validation; maintained-direct and
  per-Build wiring (`filtered`/`not-found` disambiguation on per-Build via
  one matcher check against the full item list); missing-anchor → first page
  + reason; gate oracles extended; metric-sort anchor regression test —
  correct by construction (verified 2026-07-06: every metric-joined domain is
  per-Build with the overlay applied before the store is built —
  `pods.go:291`→`321`, `namespace_workloads.go:309`, `nodes.go:365` — and none
  of the 8 maintained-direct domains joins metrics), so an anchored jump on a
  cpu/memory sort ranks against current-tick values; pin that with a test.
- [x] ✅ **P4 — Catalog/Browse parity** (2026-07-06; anchored serves through
  `queryViaEngineWithStore` with summary resolution + the UID identity
  cross-check — the catalog is the one path whose rows carry UID; browse scope
  parse now captures the real cluster id for the same-cluster rule;
  `CatalogSnapshot` + TS mirror carry anchor/pageStartRank). Same engine call
  through `queryViaEngine`; catalog snapshot scope parsing; Browse result
  plumbing (PreviousToken already flows there).
- [x] ✅ **P5 — Executor unification** (2026-07-06). The step-1 trace concluded
  the bespoke executor was ALREADY production-unreachable: its only reference
  was the `!Enabled` guard inside `applyTypedTableQueryViaStore`, whose sole
  production caller pre-checks `Enabled`; window mode is served by
  `truncateSnapshotWindow` (a truncation of domain-canonical-ordered rows, not
  an executor) and never flowed through the bespoke path. Step 2 (route the
  window path through the engine) is therefore MOOT and deliberately not done —
  enginifying the window path would risk changing non-query window ordering
  (domain canonical order is not always a schema sort key) for zero defect.
  Shipped: dead guard deleted (precondition documented), the executor cluster +
  legacy codec + `signature()` moved verbatim to
  `typed_table_query_oracle_test.go` where the parity gates keep using it as
  the oracle, `cursor.go` package doc rewritten. Full snapshot suite green.
- [x] ✅ **P6 — Per-Build store reuse** (2026-07-06; `perBuildStoreCache` +
  `withPerBuildCache` variadic serve option — 15 non-metric call sites
  untouched; wired into pods/workloads/nodes whose per-cluster builders own
  the slot, so teardown drops it; key = matched-set inputs + version watermark
  + DynamicRevision, i.e. exactly the domain's existing refetch identity —
  anything it doesn't cover (workloads' HPA overlay) was already served stale
  by 304s, no new staleness class; the backend `responseCache` verified to be
  an unrelated layer. Measured at 100k rows: 618.9 ms → 0.024 ms quiet page
  turns; churn 627.6 ms ≈ uncached, quiet-only win recorded in
  `large-data.md`).
- [x] ✅ **P7 — Frontend hook** (2026-07-06). Shipped beyond the letter of the
  plan: counted serves now also mint a **self cursor** (`Page.SelfCursor` →
  envelope/catalog `self`) because page-stable live refetches after a landing
  need a token addressing the landing page itself — the engine only minted
  prev/next boundaries. The hook adopts it after a found landing (one
  redundant quiet refetch per jump, cheap via P6's cache, zero special-cased
  fetch machinery). Export drift guard: walk restarts once then
  warn-and-delivers via `errorHandler` (typed + Browse walks), comparing the
  RAW `sourceVersions["object"]` clock per the folded-token trap. Anchor
  intent lifecycle (one-shot, re-anchor on
  soft reset, clear on manual pagination, `cursorInvalid` retry-with-anchor);
  `pageIndex` seeded from rank; **delete `previousTokens`** → backend
  `previous`; fix the stale soft-reset comment (F8); export-walk drift guard
  on `sourceVersions["object"]` — restart once, then deliver with the visible
  drift annotation (never the scope-folded `sourceVersion` token; see
  Export-walk consistency guard) — with a churning-domain test; keyboard
  parity; quiet-refetch behavior unchanged (no dim/spinner/focus loss).
- [x] ✅ **P8 — Anchor UI** (2026-07-06, one deviation + one manual step noted).
  Implemented as an upgrade of the EXISTING `gridtable:focus-request`
  machinery (alt-click navigation from object panel/related rows/object map
  already emits it with the full ref, and its buffer+match path already does
  highlight + virtualization-aware scroll): the focus request now retains
  group/version/uid (builtin GVK backfilled), and a query-backed table whose
  loaded page cannot match a pending request fires `anchorTo` once per
  request — the landing page then contains the row and the normal match takes
  over. Requests without a version (synthetic kinds) degrade to today's
  current-page-only behavior. DEVIATION: the missing-anchor notice ships via
  the app's notification channel (`errorHandler`, same as the export-drift
  warning) rather than a new inline GridTable banner — no banner surface
  exists and inventing one for a single feature failed the
  smallest-complete-change bar; `anchorResult` is exposed on the hook for a
  future inline slot. MANUAL STEP REMAINING: the visual pass under
  virtualization (jump to a deep row on a cluster with enough rows) — the
  scroll path is pre-existing code, but this phase's visual verification has
  NOT been run.
- [x] ✅ **P9 — Position honesty + numbered jumps** (2026-07-06). The
  benchmark gate FIRED: an O(rank) count on plain cursor serves costs the
  QueryAround class (33.16 ms deep at 250k vs the 17.67 ms budget), so
  `PageStartRank` stays anchor/offset-only, documented in `large-data.md` —
  cursor-page footers keep client arithmetic between jumps. `startRank`
  shipped end-to-end (contract + both typed paths + catalog + browse scope
  round-trip incl. `normalizeCatalogScope` param preservation); numbered
  page-jump input lives in the ONE shared footer control
  (`QueryPaginationControls`), self-gated on `totalIsExact`, wired for typed
  tables (`jumpToPage`) and Browse (`onJumpToPage`); jump landings adopt the
  `self` cursor for page-stable refetches. `PageStartRank` (`*int` —
  rank 0 vs absent must survive `omitempty`) on every response behind its
  benchmark gate (adds an O(rank) walk to deep unfiltered serves — if the
  benchmark regresses budgets, keep it anchor/offset-only and document);
  footer range rendered from serve-time rank; `StartRank` offset pages +
  numbered page-jump UI, offered only while `totalIsExact` (approximate
  totals keep first/prev/next only, per `large-data.md`). Browse rides the
  same `StartRank` for its numbered jumps (P4 parity); the catalog snapshot's
  `BatchIndex`/`TotalBatches` stay diagnostics-only (`catalog.go:58-63`,
  pinned by `TestCatalogPaginationIsKeysetNotBatch`) — do not repurpose them
  as page state. Update `large-data.md` contract sections for
  anchor/previous/startRank.

## Decisions (resolved 2026-07-06)

- **Aligned page, not centered window** — "first/last/middle" falls out of
  alignment; ◀/▶ pages match pages reached from page 1; numbering stays
  meaningful.
- **Anchor in the request, not the cursor** — cursors stay backend-minted
  boundaries; no signature changes.
- **Rank derived per request, never stored** — sort/filter dependence handled
  by construction; nothing to invalidate.
- **Missing anchor returns page 1 + a user-visible reason** in one round trip.
- **Live refetches do not re-anchor** (page-stable, not object-stable);
  sort/filter/page-size changes do re-anchor; manual pagination clears the
  intent.
- **Backend `Previous` replaces the client token stack** — required for
  backward paging from a landing; kills the typed-vs-Browse divergence. The
  envelope field already exists unpopulated (`resource_query_contract.go:174`);
  wiring it — and deleting the vestigial `ResourceQueryResult` (F11) — rides
  P3.
- **Anchor resolution is serve-layer-owned** — the engine takes a resolved
  store row key; typed = adapter `AnchorKey` (name-shaped, same helpers as
  `Key`), catalog = items-map lookup → `catalogEngineUID`. Anchor `UID` is an
  identity cross-check only where rows carry one (catalog today; typed
  summary rows have no UID field, and matching by name-shaped key is the
  wanted "show in list" behavior for recreated objects).
- **Delete `Cursor.Revision`; walk consistency comes from
  `sourceVersions["object"]`** — the dead field's intended job already has a
  live clock (the raw per-source clock, NOT the scope-folded `sourceVersion`
  token, which differs on every export page by construction).
- **Export drift warns-and-delivers; it does not hard-fail** — the clock
  advances on every store mutation, so drift is near-certain on busy domains
  and a hard fail would break export exactly there. Silent drift stays
  banned: restart once, then complete with a user-visible annotation. Failed
  pages keep hard-failing per the existing CSV/copy rule.
- **Collapse `Position` to one value** — matches the one-comparable-per-row
  invariant; multi-component was contract fiction.
- **One production executor** — the bespoke path becomes the oracle;
  equivalence proven by gates before the switch, not after.
- **Per-Build fix is reuse, not maintained conversion** — converting
  cross-kind-join domains to maintained stores would bake serve-time joins,
  violating the late-arrival rules in `data-layer.md`; a version-keyed cache
  fixes the waste without touching join semantics.
- **No order-statistics augmentation** — counted walk is within measured
  budgets; revisit only on a measured regression.
- **Cross-cluster anchors are a validation error** — navigate first, then
  anchor.

## Explicitly out of scope

- **Backend bulk-export endpoint.** The client-driven cursor walk is a
  documented product decision (`large-data.md` CSV/copy rule); this plan
  hardens it (drift guard) rather than replacing it.
- **Follow-object mode** (live re-anchoring on data change) — separate
  feature with its own UX questions.
- **Offset pagination beyond exact-total numbered jumps** — approximate-total
  scopes keep keyset-only navigation, per the existing contract.
- **Order-statistics indexes** — parked behind measured regression, as today.
