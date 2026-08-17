# Settled Structural Findings

Read this before proposing app-wide structural opportunities. Re-propose an
item only with current repository evidence that overturns its recorded verdict.

## Consolidated

- Object-panel Overview rendering uses one per-kind descriptor registry, a
  generic `OverviewRenderer`, and a runtime drift check. See
  `docs/frontend/component-structure.md`.
- Object-panel actions use shared `useObjectActionController`; there is no
  panel-local action reducer.
- Query-backed cluster tables own their base-scope refresh leases. Contexts do
  not hold domain data or a `clusterDomainScopes` manifest.
- LogViewer async state is the `LogViewMode` discriminated union in
  `frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts`.
- The resource-kind registry drives the catalog, table rows, generated detail
  dispatch, object map, and stream summaries. See
  `docs/architecture/resource-kind-registry.md`; remaining exceptions are
  intentional facets.

## Investigated and dismissed

- **Snapshot query consolidation:** `typed_table_query.go` is the query engine;
  `static_table_query.go` contains thin adapters. The remaining overlap is
  limited to numeric sort helpers and similar event adapters.
- **Cross-owner mutex consolidation:** owner mutexes protect independent state;
  the mutation test proves kubeconfig callbacks do not run under the selection
  lock. Do not reintroduce a composition-root lock.
- **Cluster lifecycle state machine:** lifecycle state is centralized in
  `cluster_lifecycle.go`. Residual work is limited to reading that state instead
  of a few inline `authManager.IsValid()` checks.
- **One context/cancellation hub:** separate context hierarchies are intentional.
  Residual work is cancellation of in-flight recovery/catalog callbacks during
  shutdown.
- **Permission cache unification:** SSAR booleans, SSRR rule blobs, and transient
  GET deduplication serve different consumers. Only their background-refresh
  boilerplate is a possible small consolidation.
- **Table configuration schema:** shared behavior already lives in
  `useGridTablePersistence`, `useGridTableBinding`, and
  `useResourceGridTableCommon`; public grid hooks are thin adapters.
- **Namespace scope unification:** `normalizeNamespaceScope` has two consumers,
  which did not justify another abstraction.

## Trigger-gated

- Re-inventory current namespace and cluster data paths before reviving
  view-owned live-window fetch; its historical temporary plan was removed.
- Consider a persistent SQLite catalog store only after evidence from a
  100k-plus-object cluster shows Browse or custom-resource degradation.
