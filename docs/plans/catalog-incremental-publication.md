# Catalog incremental publication

## Scope and target

Preserve catalog identity, query results, metadata, readiness, and signal ordering
while maintaining published indexes incrementally after watch/ingest changes.
Keep discovery, full resync, source adapters, and contention recovery. Table and
panel refactors are separate follow-up work.

## Ownership and ordering

- Producers: informer/custom watch batches and ingest upsert/delete/replace sinks.
- Owner: the per-cluster catalog index and its publication boundary.
- Consumers: catalog/catalog-diff snapshots, identity/UID lookup, namespace and
  kind metadata, finalizer findings, and the catalog doorbell bridge. Browse and
  custom-resource tables consume the resulting scoped snapshots.
- Publish rows, lookup indexes, facets, and finalizer findings before signals.
  Full resync retains warm query results until replacement publication.
- Preserve `syncMu` before catalog publication locking. Ingest callbacks must
  enqueue reconciliation rather than waiting while holding a source-store lock.
  Keep the existing catalog-owned interfaces to avoid a stream-manager cycle.
- Incremental mutation makes query-store pointers mutable; page, total, and
  facet reads must share catalog publication ownership for a consistent result.

## Work and evidence

- [x] Add and run failing incremental-publication regression; benchmark baseline.
- [x] Maintain published query/identity/facet/finalizer indexes from changes.
- [x] Preserve resync contention, recreation, and publication-before-signal.
- [x] Run focused catalog, snapshot, bridge, and Browse tests.
- [x] Measure backend coverage and changed-function complexity.
- [x] Exercise live Browse create/update/delete and record freshness evidence.
- [x] Run prerelease gate and inspect its formatting changes.
- [x] Update the owning [catalog contract](../architecture/catalog.md).

## Validation record — 2026-09-20

All repository commands used `mise exec --`, with Go caches under `/tmp`.

- Red: `go test ./backend/objectcatalog -run '^TestIncrementalCatalogPublication$'
  -count=1` failed on both watch and ingest paths: three changes increased the
  full-rebuild counter from 1 to 4. The same regression passed after implementation.
- Focused: `go test ./backend/objectcatalog ./backend/refresh/snapshot ./backend
  -run 'Test(Incremental|Catalog|SourceReplay|IngestReplacement|WatchChangeDuring|Gateway)'
  -count=1` passed. Coverage includes UID recreation, query equivalence, concurrent
  publication consistency, replay signal ordering, unchanged finalizer findings,
  full-sync contention recovery, production Gateway informer handlers, snapshots,
  and catalog bridges.
- Frontend: `npm --prefix frontend run test -- --run src/modules/browse` passed
  107 tests in 12 files, including catalog freshness integration tests.
- Coverage: `wails3 task test:backend-coverage` passed after the final tests.
  Object catalog: 89.1%; the six changed production files with logic changes:
  741/805 statements (92.0%); new incremental publication helpers: 100%.
- Complexity: pinned `gocognit@v1.2.1` scanned those six production files.
  Maximum local score: 12. This is local analysis, not a pushed Sonar result.
- Final gate: `wails3 task qc:prerelease` exited 0, including Go race tests,
  vet/staticcheck, bindings, frontend lint/types, 5,049 tests across 524 frontend
  files, Knip, documentation links, and the configured vulnerability scan.
  Worktree inspection found only the intended catalog code, tests, and docs.

### Native freshness check

Used the native Wails development build and a disposable Kind cluster,
`codex-catalog-check`, namespace `catalog-refactor-check`. The app reported Ready.
The standalone Playwright check first encountered `/wails/runtime` 404s on the
Vite URL; server mode then rejected native workspace identity. Native computer
interaction supplied the live evidence instead; no mocked bridge was used.

Native accessibility observations during external `kubectl` mutations:

1. Namespace Browse loaded its two initial objects: the root CA ConfigMap and
   default ServiceAccount.
2. Creating `catalog-publication-check` added a ConfigMap row. A temporary custom
   label column displayed `catalog-check=created`.
3. Updating the label changed the visible cell to `updated` without manual refresh.
4. Creating `catalog-facet-check` added a ResourceQuota row and ResourceQuota to
   the Kinds vocabulary. A name filter reported `Showing 1 of 4 items`.
5. Completed external deletion of both objects changed that filtered view to
   `Showing 0 of 2 items` and its empty state. Clearing the filter restored the two
   baseline rows; ResourceQuota disappeared from the Kinds vocabulary.
6. Native Cluster Data diagnostics reported catalog healthy/delivering and
   connected, one full catalog resync, zero fallbacks, eight delivered batches,
   and zero dropped messages. Changes were observed before the five-minute full
   resync interval. The disposable cluster had no metrics-server; metrics errors
   were separate from the healthy catalog feed.

The temporary column was removed, the cluster tab closed, the development
processes stopped, and the Kind cluster and its two kubeconfig files deleted.
After the user's follow-up authorization, the two pre-test saved cluster
selections were restored and read back on 2026-09-20. The active cluster remains
empty; other preferences were preserved.

### Publication microbenchmark

`BenchmarkCatalogIncrementalPublication`, five iterations per sample, three
samples on Apple M2 Max, measured one ingest update against a populated catalog.

| Catalog size | Before | After |
| --- | --- | --- |
| 10,000 objects | 95–99 ms/update | 0.119–0.137 ms/update |
| 100,000 objects | 1.36–1.41 s/update | 0.129–0.134 ms/update |

These measure backend publication cost, not end-to-end UI latency. Updates still
rebuild the small kind/namespace vocabulary, and whole-kind replacement scans the
membership map. Queries hold the publication read lock for consistent rows,
counts, and facets; long queries can delay a publisher. Full resync, source
adapters, retry policy, and recovery remain in place.


## Follow-up: shared query-page mechanics

### Scope, ownership, and constraints

Consolidate search debounce, applied cursor/page state, request delivery, and
query stream identities across typed tables and Browse. Preserve their distinct
payload interpretation, warm-up retry, navigation rollback, quiet-request
coalescing, metadata scopes, and reset timing. No new source mode or UI behavior.

- Producers remain typed refresh query snapshots and catalog query snapshots.
  Data access owns temporary query leases and acquire/fetch/read/release.
- Typed queries remain declarative. Browse keeps its imperative cursor requests
  and separately subscribed base and metadata scopes. The shared session owns
  only applied cursor/footer state, not requested-cursor or payload policy.
- Query readiness must still permit acquisition/acknowledgement needed to become
  ready. Discard results after scope changes or supersession; preserve the
  existing adapter-specific error delivery and loading cleanup.
- Reset rows before commit on hard scope changes. Publish landed cursors and
  position together; payload writes must not look like new stream signals.
- Core stream helpers depend only on core refresh/data access. Shared query-page
  helpers depend on data access, never on Browse, preventing a dependency cycle.
- Existing contract tests cover cluster/namespace isolation, readiness,
  cancellation, warm-up, rollback, cursor expiry, anchors, numbered jumps,
  structural sharing, live signals, and exports. Add gaps at consumer boundaries.

### Resource-table inventory

The production classification remains enforced by
`gridTableViewRegistry.contract.test.ts`, including direct GridTable exceptions.

| Surface | Source and mode | Affected path |
| --- | --- | --- |
| Browse and custom resources | Catalog query, static page | Browse adapter |
| Aggregated config/RBAC/storage/network/CRD/quota/autoscaling views | Typed query, static page | Typed adapter |
| Namespace Pods/Workloads and cluster Nodes | Typed query, dynamic metrics page | Typed adapter |
| Namespace Events/Helm, cluster Events/Attention | Typed query, static page | Typed adapter |
| Object-panel Pods | Typed query with owner predicates | Typed adapter |
| Global clusters and namespace summary | Bounded inventory | Unchanged |
| Object-panel related-resource tables and Events | Bounded/explicit partial | Unchanged |
| Parsed logs and diagnostics | Explicit non-inventory exceptions | Unchanged |

Backend queries continue to own global search, sort, facets, and counts. Page
limits remain bounded by the existing options; exports retain the shared full
cursor walk. Visible-row actions retain complete object identity and cluster
scope. No frontend loaded-prefix inference is introduced.

### Work and evidence

- [x] Baseline: 86 tests in five query/signal suites passed before edits.
- [x] Consolidate mechanics and migrate both adapters.
- [x] Run focused adapter, freshness, table-classification, and request tests.
- [x] Measure affected coverage and changed-function complexity.
- [x] Exercise representative typed and Browse query interactions in Wails.
- [x] Run prerelease gate and inspect final worktree.
- [x] Document the shared boundary and record cleanup/remaining verification.

### Query validation record — 2026-09-20

- Focused suites: 210 tests across 21 files passed, covering query adapters,
  Browse/custom-resource consumers, stream signals, table classification, and
  data access. Added numbered-jump/self-cursor reconciliation and overlapping
  quiet-refresh/user-navigation coverage. Adapter tests mock the data-access
  response boundary; native checks below exercise the actual backend.
- Full frontend coverage suite: 5,050 tests across 524 files passed. The six
  changed production files covered 597/644 statements (92.70%). File coverage:
  Browse 94.73%, typed query 91.63%, query wrapper 86.17%, page session 97.36%,
  request delivery 100%, and stream hooks 97.36%.
- Local complexity: Biome with a temporary maximum of 12 reported no changed
  function or new helper above 12. Its only finding was the unchanged focus
  request effect in `useAnchorOnUnmatchedFocusRequest` (14); the full-file
  command therefore exited 1. The diff changes only signal consumption in
  that file, outside the flagged function. No repository thresholds or
  suppressions changed. No pushed Sonar analysis was requested.
- Final gate: `mise exec -- wails3 task qc:prerelease` exited 0, including Go
  race tests, vet/staticcheck, bindings, frontend lint/types, 5,050 tests in 524
  files, Knip, documentation links, and the configured vulnerability scan.
  The gate reported no frontend formatting changes. Final worktree inspection
  found only the intended query code, tests, and documentation changes.

### Native query checks and cleanup

Used the native Wails development build with disposable Kind cluster
`codex-query-check`, namespace `query-refactor-check`, and 260 test ConfigMaps.
The existing 250-row preference was preserved.

1. Browse displayed its loading state, then 262 catalog objects. Next/previous
   navigation and the numbered page control moved between pages one and two.
2. On Browse page two, external deletion of `query-check-260` removed its row,
   changed the footer from 251–262 of 262 to 251–261 of 261, and retained page two.
3. Typed Config displayed 260 rows after that deletion. Next/previous and the
   numbered control moved between pages one and two.
4. On typed page two, externally adding a data key to `query-check-259`
   changed its visible Data Items cell from 1 item to 2 items without navigation.
5. Both tables retained keyboard focus while searching for that object,
   displayed one matching row, displayed an empty result after adding a
   nonmatching suffix, and returned to page one after clearing the filter.
6. Switching to namespace `default` replaced the test namespace's rows:
   typed Config showed only its root CA ConfigMap; Browse showed the root CA,
   Kubernetes Service/EndpointSlice, and default ServiceAccount.

The direct Playwright navigation to the emitted Vite URL again reported
`/wails/runtime` 404s because native bindings are unavailable there. Native
interaction supplied the runtime evidence. Error, warm-up retry, cancellation,
and permission cases are covered by automated adapter tests, not native error
injection. This cluster had no metrics-server; no live metric-sort claim is made.

The development app and its processes were stopped. The disposable cluster and
both temporary kubeconfigs were deleted. The saved cluster selections and active
state captured before this phase were restored and read back successfully.
The [query contract](../architecture/large-data-query.md) now records the shared
mechanics and adapter-owned policies. Panel placement remains a separate phase.
