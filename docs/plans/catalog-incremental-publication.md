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
Restoring the pre-test saved cluster selection remains pending explicit user
approval after automatic approval review rejected the preference restoration.
The active cluster is empty.

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
