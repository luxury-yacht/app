# App-Wide Table Hardening

Status: Active. The previous large-table work completed the first production
slice: Browse, Custom resource catalog paging, all-namespaces Pods,
all-namespaces Workloads, backend-owned query export/bulk support for supported
query surfaces, and shared table-mode enforcement. That does not satisfy the
app-wide goal below.

Goal: no production table can mislead users or fall over at large scale. Every
table must either have backend-owned global query semantics, prove a complete
bounded dataset, or clearly present itself as a recent/capped/partial view with
matching counts, filters, export, selection, and destructive-action semantics.

## Baseline Already Captured

Durable rules from the first slice live in
[`docs/architecture/large-data.md`](../architecture/large-data.md) and
[`docs/frontend/gridtable.md`](../frontend/gridtable.md). They cover table
modes, query-backed catalog behavior, typed query contracts, cursor semantics,
Browse budgets, and the completed high-risk migrations for Custom resources,
all-namespaces Pods, and all-namespaces Workloads.

Do not recreate the old completed implementation plan. This document tracks the
remaining work needed to meet the app-wide product goal.

## Current Table Disposition

Completed query-backed surfaces:

- Browse: `Query Backed Static`.
- Cluster and namespace Custom resources: `Query Backed Static` through catalog
  paging and current-page hydration.
- All-namespaces Pods: `Query Backed Dynamic`.
- All-namespaces Workloads: `Query Backed Dynamic`.

Remaining `Local Partial` surfaces that need query migration or stronger
partial UX/action limits:

- Namespace Events, Cluster Events, Object Events.
- Namespace Config, Network, Storage, Quotas, Autoscaling, Helm.
- Parsed logs, where table-like filtering/export is bounded by the log buffer.

Remaining `Local Complete` or conditional surfaces that need measured bounds or
query migration:

- Cluster Nodes.
- Namespace RBAC.
- Cluster Config, Storage, RBAC, CRDs.
- Object-panel related Pods and Jobs if any owner scope can become
  namespace/cluster-scale.

Remaining backend architecture gap:

- `backend/objectcatalog.Service` still owns the in-memory catalog index
  directly. A replaceable `CatalogQueryStore` seam is not implemented.

## Non-Negotiable Rules

- `clusterId` must be present in every cluster-data query, cache key,
  persistence key, row identity, action, and selection descriptor.
- Concrete object refs crossing boundaries must include `clusterId`, group,
  version, kind, namespace when namespaced, and name.
- Query-backed tables must not locally search, filter, sort, count, or derive
  facets from the current page as if it were the full result set.
- Local Partial tables must visibly state that they are recent, capped,
  buffered, degraded, or otherwise incomplete.
- Local Partial export, selection, select-all, and destructive actions apply
  only to the visible/windowed rows unless a backend query-wide operation exists.
- Local Complete tables require a real bound. A user-tunable row cap is not a
  bound.
- Pagination UI must be coherent: controls together, visible range, page size,
  previous/next availability, and exact total/page count only when the backend
  can honestly provide exact totals.

## Phase 0: Reconcile Scope And Evidence

- [ ] Remove any remaining docs or release text that implies app-wide table
      hardening is complete.
- [ ] Re-run the production table inventory against current code:
      `GridTable`, `ResourceGridTableView`, resource-grid hooks, direct
      `useTableSort`, export hooks, and bulk-action hooks.
- [ ] For every table, record producer, scope, completeness, current mode,
      counts/facets source, pagination model, export/selection semantics, and
      expected worst-case cardinality.
- [ ] Add or update a static contract test that fails when a new production
      table lacks mode classification or bypasses the shared resource-grid
      mode contract.

Acceptance:

- The inventory has no "unknown" producer, scope, mode, or action semantics.
- Completed-scope language names only Browse, Custom, all-namespaces Pods, and
  all-namespaces Workloads.

## Phase 1: Make Partial Tables Honest

- [ ] For Events, display that results are recent/windowed and ensure counts,
      empty states, filters, sort, CSV, selection, and bulk actions describe or
      enforce the recent window.
- [ ] For namespace Config, Network, Storage, Quotas, Autoscaling, and Helm,
      surface capped/partial state from the backend producer instead of showing
      normal global table semantics over a capped snapshot.
- [ ] For Parsed Logs, ensure filtering/export language is scoped to the
      current log buffer.
- [ ] Add tests proving Local Partial tables do not expose global totals,
      global facets, all-matching export, or query-wide destructive actions.

Acceptance:

- No Local Partial table looks like a complete global table.
- Every Local Partial table has visible partial-state UI and action limits.

## Phase 2: Prove Or Migrate Local Complete Tables

- [ ] Establish measured fixtures and thresholds for Cluster Nodes, Namespace
      RBAC, Cluster Config, Cluster Storage, Cluster RBAC, and Cluster CRDs.
- [ ] Keep a table Local Complete only when the domain is naturally bounded or
      measured below the table budget under large-cluster fixtures.
- [ ] Migrate any table that exceeds the budget to `Query Backed Static` or
      `Query Backed Dynamic`.
- [ ] Verify object-panel related Pods and Jobs remain owner-scoped and cannot
      accidentally fan out to namespace/cluster scale.

Acceptance:

- Every Local Complete table has a documented measured bound or has been
  migrated.
- No local table depends on `maxTableRows` or another user setting for
  correctness.

## Phase 3: Expand Typed Query Coverage

- [ ] Add typed query support for high-cardinality namespace resource families
      selected by Phase 1/2 evidence.
- [ ] Add typed query support for high-cardinality cluster resource families
      selected by Phase 1/2 evidence.
- [ ] Preserve table-specific predicates and projected fields in backend query
      contracts instead of reimplementing them as frontend local filters.
- [ ] Keep metric-backed sorts backend-owned with an explicit dynamic revision
      model.

Acceptance:

- All high-cardinality all-namespaces and cluster-scope tables have
  backend-owned search/filter/sort/page semantics.
- The frontend renders only the current page/window for migrated tables.

## Phase 4: Finish Degraded-State Semantics

- [ ] Extend query results and snapshot table stats with reason-bearing
      degraded state for stale data, unavailable metrics, permission-blocked
      kinds/namespaces, capped snapshots, failed fanout, approximate totals, and
      approximate facets.
- [ ] Render table-level degraded/partial state consistently in Browse,
      Custom, Pods, Workloads, Events, and every remaining Local Partial table.
- [ ] Ensure permission-denied or unavailable data is not silently dropped while
      reporting exact results.

Acceptance:

- Users can tell when a table is complete, approximate, stale, capped,
  permission-limited, or metric-degraded.
- Exactness flags and reason strings agree between backend result contracts and
  UI copy.

## Phase 5: Make Pagination Production-Quality

- [ ] Unify query-backed pagination controls in the table footer.
- [ ] Show page size and visible range, such as `Showing 101-200 of 2,431`.
- [ ] Show `Page N of M` only when total is exact; otherwise show an
      approximate total without pretending random access exists.
- [ ] Keep first/previous/next available for cursor-backed tables. Add numbered
      page jumps only if the backend implements a bounded random-access or
      offset-into-index contract.
- [ ] Remove instructional filler such as "Use Next page to navigate results."
- [ ] Add interaction tests for initial load, filter changes, page-size
      changes, cursor invalidation, and page state reset.

Acceptance:

- Pagination controls are visually and semantically one control group.
- Users can see where they are in the result set without the UI overstating
  backend capabilities.

## Phase 6: Add The Catalog Query Store Seam

- [ ] Introduce a `CatalogQueryStore` interface behind `backend/objectcatalog`.
- [ ] Move the in-memory catalog index behind that interface without changing
      frontend contracts.
- [ ] Keep benchmarks for the current in-memory implementation.
- [ ] Document the decision point for SQLite or another backing store.

Acceptance:

- Storage can be swapped without changing query request/result contracts.
- The current in-memory implementation remains benchmarked and covered.

## Phase 7: Regression Coverage And Validation

- [ ] Add first-load tests for all-namespaces and single-namespace versions of
      every query-backed table.
- [ ] Add tests for namespace filter initialization, deselection back to
      all-namespaces, table persistence keys, and filter state publication.
- [ ] Add backend contract tests for degraded reasons, typed query predicates,
      cursor signatures, and exactness flags.
- [ ] Add large-fixture benchmarks for every table family migrated in this
      plan.
- [ ] Run `mage qc:prerelease` before calling implementation complete.

Acceptance:

- The exact all-namespaces first-load class of bug is covered for query-backed
  namespace tables.
- Validation is based on the latest worktree, not an earlier intermediate fix.

## Definition Of Done

- Every production table is either query-backed, proven Local Complete, or
  visibly Local Partial.
- No table presents local transforms over a capped/windowed dataset as global
  search, filter, sort, counts, or facets.
- No high-cardinality table requires loading all matching rows into React.
- Export, select-all, and destructive bulk actions match the table mode.
- Degraded, stale, permission-blocked, unavailable-metric, capped, approximate,
  and partial states are visible and reason-bearing.
- Query-backed pagination is coherent, grouped, and honest about totals/page
  counts.
- Catalog query storage has a replaceable interface seam.
- `mage qc:prerelease` passes on the final implementation.
