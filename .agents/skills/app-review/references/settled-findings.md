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
  intentional facets.

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
- **Namespace scope unification:** `normalizeNamespaceScope` has two consumers,
  not enough to justify another abstraction.

## Trigger-gated

- View-owned live-window fetch: re-inventory current namespace and cluster data
  paths before reviving it (its temporary plan was removed).
- Persistent SQLite catalog store: only after a 100k-plus-object cluster shows
  Browse or custom-resource degradation.
