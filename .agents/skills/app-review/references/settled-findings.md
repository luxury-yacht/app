# Settled Structural Findings

Read before proposing app-wide structural opportunities. Re-propose an item only
with current repository evidence that overturns its verdict.

## Consolidated

- Object-panel Overview: one per-kind descriptor registry, generic
  `OverviewRenderer`, and a runtime drift check
  (`docs/frontend/component-structure.md`).
- Object-panel actions: shared `useObjectActionController`; no panel-local
  action reducer.
- Query-backed cluster tables own their base-scope refresh leases; contexts hold
  no domain data or `clusterDomainScopes` manifest.
- LogViewer view mode is `LogViewMode` (`live | previous`) in
  `frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts`;
  previous logs live in component state, and the stream manager is the only
  writer of `container-logs` state. Container and Node Logs share one viewer
  shell (options reducer, presentation hook, toolbar, shortcuts, copy action).
- The resource-kind registry drives the catalog, table rows, generated detail
  dispatch, object map, and stream summaries
  (`docs/architecture/resource-kind-registry.md`); remaining exceptions are
  intentional facets. Per-kind frontend decisions (panel tabs, pods scope,
  metrics, short names) read the generated kind-facets table (#404).
- Refresh scopes: each domain authors its `scopeContract`; one codec per layer
  builds and decodes every scope, and both suites run every domain's examples
  (`docs/architecture/refresh-system.md`, "Scope and identity"; #397). The old
  hand-written scope parsers, including `normalizeNamespaceScope`, are gone.
- The object-details payload is a tagged `ObjectDetail` union narrowed on
  `detailType`; consumers never cast `details`
  (`docs/frontend/component-structure.md`; #397).
- Refresh demand: leases are the only demand signal; the orchestrator owns
  them (`docs/architecture/refresh-system.md`; #398).
- Change signals: maintained stores ring only after applying a change, through
  one pipeline (`docs/architecture/data-freshness.md`; #399).
- Feeds: every built-in kind, Events included, comes from an owned reflector;
  the shared informer factory and the `IngestOwned` facet are removed
  (`docs/architecture/data-layer.md`; #402).
- Panel placement: the directory is the only writer of which renderer and group
  hold a panel; windows publish arrangement reports
  (`docs/frontend/dockable-panels.md`; #401).
- App preferences: one typed store (`getPreference`, `subscribePreference`,
  `usePreference`; #400), and the schema (keys, defaults, bounds) is generated
  from Go with a Go-vs-TS parity fixture (`docs/architecture/app-preferences.md`;
  #405).
- Frontend tests run app state owners for real through
  `installAppStateHarness()`; a Biome plugin fails a suite that mocks one
  (`docs/workflows/testing.md`, "Frontend state: the real-state harness"; #403).

## Investigated and dismissed

- **Snapshot query consolidation:** `typed_table_query.go` is the query engine
  and `static_table_query.go` holds thin adapters; overlap is limited to numeric
  sort helpers and similar event adapters.
- **Cross-owner mutex consolidation:** owner mutexes protect independent state;
  the mutation test proves kubeconfig callbacks do not run under the selection
  lock. Do not reintroduce a composition-root lock.
- **Cluster lifecycle state machine:** already centralized in
  `cluster_lifecycle.go`; residual work is reading that state instead of a few
  inline `authManager.IsValid()` checks.
- **One context/cancellation hub:** separate context hierarchies are
  intentional; residual work is cancelling in-flight recovery/catalog callbacks
  during shutdown.
- **Permission cache unification:** SSAR booleans, SSRR rule blobs, and
  transient GET deduplication serve different consumers; only their
  background-refresh boilerplate is a possible small consolidation.
- **Table configuration schema:** shared behavior already lives in
  `useGridTablePersistence`, `useGridTableBinding`, and
  `useResourceGridTableCommon`; public grid hooks are thin adapters.
- **Generating Diagnostics from the domain contract (2026-10-20):** about 7,700
  frontend lines mirror refresh internals by hand, with ~98 domain names, but
  no drift was found. Revisit only with a concrete mismatch.
- **Replacing `KubeconfigContext`'s selection and visibility queues:** they are
  deliberate; commands carry no sequence number
  (`docs/architecture/multi-cluster.md`). Replacing them needs per-window
  command sequencing; revisit only if tab-switch races recur.
- **Wails boundary facade (2026-10-20):** disciplined; one frontend file
  bypasses `@core/backend-api`.
- **Long-lived session lifecycle:** drains, port-forwards, and node shells
  already share `runtimeOperationRegistry` with cleanup
  (`backend/runtime_operations.go`).
- **Cluster attention and overview:** large but cohesive; neither re-derives
  pod or node health.
- **Splitting the root `backend` package (2026-10-19):** the warm test rebuild
  took 4.7 s, AST tests already enforce ownership, and the generated Wails
  binding anchor must stay in package `backend`.
- **Memory tiering (governor, spill, Cold mmap serving):** complex but
  deliberate; no cost evidence found (2026-10-19).
- **Appearance live preview:** palette, accent, and link controls keep their
  drafts, so a failed save or another window's change shows after a light/dark
  switch. Declined; documented in `docs/architecture/app-preferences.md`.

## Trigger-gated

- View-owned live-window fetch: re-inventory current namespace and cluster data
  paths before reviving it (its temporary plan was removed).
- Persistent SQLite catalog store: only after a 100k-plus-object cluster shows
  Browse or custom-resource degradation.
- Object-map build reuse (resolving edges only for reached objects, or one
  index per cluster reused across scopes and polls): only if
  `BenchmarkObjectMapBuild` exceeds 100 ms at 10k Pods. It measured about
  57 ms on 2026-10-16.
- Re-keying object-map's kind-keyed tables (`objectMapGraphByKind`,
  `objectMapEdgeBuilders`) by full identity: the frontend map gate already
  checks the full GVK, so no failure remains. Do it only when other work
  touches those lines.
