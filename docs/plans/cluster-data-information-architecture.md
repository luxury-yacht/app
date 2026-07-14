# Cluster Data Information Architecture

## Overview

Move cluster-data navigation from a flat scope-and-kind list toward intent-based
lenses while preserving the existing catalog, typed-query, shared-resource-model,
and object-map ownership boundaries.

Target navigation order:

1. User intent (Observe, Run, Configure, Govern).
2. Lens (Inventory, Needs Attention, Applications, Capacity, Change, Fleet).
3. Explicit cluster and namespace scope.
4. Concrete Kubernetes objects with full cluster/GVK identity.

## Non-goals

- Do not replace the object catalog as the identity/existence source.
- Do not move backend-owned status semantics into frontend code.
- Do not locally filter or sort a query page as though it were the global row set.
- Do not create aggregate refresh scopes that omit `clusterId`.
- Do not make application grouping navigable when the source identity is incomplete.

## Current Inventory

- View vocabulary: `frontend/src/types/navigation/views.ts`.
- Sidebar lists and rendering: `frontend/src/ui/layout/Sidebar.tsx`.
- Command navigation: `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`.
- Favorite view picker and persistence: `frontend/src/ui/favorites`,
  `frontend/src/core/persistence/favorites.ts`.
- View-to-refresh mapping: `frontend/src/core/refresh/refresherTypes.ts`.
- Cluster/namespace dispatch: `frontend/src/modules/cluster/components/ClusterResourcesViews.tsx`,
  `frontend/src/modules/namespace/components/NsResourcesViews.tsx`.
- Inventory tables: `frontend/src/modules/resource-grid`, catalog and typed-query
  producers in `backend/refresh/snapshot`.
- Backend-owned status/facts/links: `backend/resourcemodel`,
  `backend/resources/<kind>`.
- Relationship graph: `backend/refresh/snapshot/object_map.go`,
  `frontend/src/modules/object-map`.

## Phases

### Phase 1: One shell view registry

- [x] Add a frontend-owned registry containing view id, scope, label, intent
      group, description, keywords, All Namespaces support, and refresher.
- [x] Derive navigation unions/runtime parsers from the registry vocabulary.
- [x] Migrate Sidebar, command palette, favorite picker, and refresher mapping.
- [x] Add registry and shell-parity tests that reject vocabulary drift.

### Phase 2: Intent-grouped navigation

- [x] Render cluster and namespace views under intent group headings.
- [x] Preserve sidebar keyboard order, selection, expansion, and accessibility.
- [x] Keep Map hidden for All Namespaces through registry capability metadata.
- [x] Add focused sidebar and keyboard tests before production changes.

### Phase 3: Needs Attention lens

- [x] Reuse the backend-owned workload health predicate and status presentation
      instead of defining health semantics in the frontend.
- [x] Keep every entry single-cluster and attach a complete object reference when
      it points to a concrete object.
- [x] Add a cluster lens that queries the matching backend health predicate and
      keeps namespace identity visible.
- [x] Prove loading/empty truthfulness, permission diagnostics, and normal
      navigation with focused tests.
- [x] Add per-namespace unhealthy-workload rollups from retained backend status
      projections, including status-only snapshot invalidation and sidebar counts.

### Phase 4: Inventory and saved lenses

- [x] Add backend-owned API-group/scope facets to catalog Inventory.
- [x] Add API identity and available backend status presentation without
      materializing unbounded datasets in React.
- [x] Make the new lens and canonical view labels available to existing favorite
      persistence without a stored-state migration.
- [x] Keep global status/owner/application filters disabled until their backend
      query projections exist.

### Phase 5: Namespace, application, and topology lenses

- [x] Expand the per-cluster namespace workload rollup into a broader aggregate
      domain for warning events, utilization, quota pressure, and degraded access.
  - [x] Add permission-honest warning-event counts, event-driven invalidation,
        and categorized sidebar badges.
  - [x] Add utilization and quota-pressure signals with explicit loading,
        available, unavailable, and stale-source presentation.
- [x] Add confidence-bearing application grouping from owner links, Helm links,
      and explicit application labels.
- [x] Add table-to-map and map-to-table navigation with complete object refs.
- [x] Keep graph limits and partial/truncated presentation visible.

### Phase 6: Fleet lens

- [x] Fan out over per-cluster overview/attention state in the frontend.
- [x] Present cluster comparison rows with explicit `clusterId` identity.
- [x] Switch cluster before navigating to a cluster-scoped lens or object.
- [x] Cover mixed ready/loading/auth-failed cluster states.

### Phase 7: Query-backed Pod facets

- [x] Extend the shared typed-query request, cursor identity, maintained-store-fed
      production path, and fallback executor with status and node facet filters.
- [x] Return stable scope-level status and node options instead of options that
      collapse to the current page or active selection.
- [x] Render and persist the provider-owned Status and Node controls in the Pods
      view for both one namespace and All Namespaces.
- [x] Prove backend executor parity, frontend scope serialization, persistence,
      focus-safe interaction, and rendered behavior before enabling the
      capabilities.

### Phase 8: Status facets across operational inventory

- [x] Add backend-query Status filtering to namespace and All Namespaces
      Workloads using the shared resource-model status projection.
- [x] Add backend-query Status filtering to Cluster Nodes using the shared
      resource-model status projection.
- [x] Keep Status options stable across active selections and fixed health
      predicates, with exact scope-level values from the typed query payload.
- [x] Prove executor parity, capability/UI projection, persisted query state,
      and rendered behavior before enabling both capabilities.

### Phase 9: Reconcile target lenses and product decisions

- [x] Decide and document whether Inventory, Capacity, and Change are names for
      existing Browse, Overview/Nodes, and Events surfaces or require distinct
      lenses; do not add routes until those mappings are explicit.
- [x] Resolve the remaining Needs Attention placement, low-confidence
      application navigation, and configured-versus-open Fleet scope questions
      with rendered evidence and explicit product decisions.
- [x] Align the plan, view registry, sidebar, command palette, favorites, and
      dispatch vocabulary with the resulting decisions, preserving stored view
      compatibility or defining a migration when an id must change.
- [x] Prove registry/shell parity, keyboard order, persistence behavior, and the
      rendered navigation before treating the target taxonomy as settled.

#### Settled taxonomy

- **Inventory** is the user-intent name for the existing cluster and namespace
  **Browse** surfaces. `browse` remains the canonical stored and dispatched view
  id; `inventory` is a command-palette search alias, not a new route.
- **Capacity** is a cross-surface concept: **Overview** provides the cluster
  summary, **Nodes** provides node-level health/scheduling/capacity detail, and
  **Fleet** compares capacity across open clusters. `overview`, `nodes`, and
  `fleet` retain their current navigation identities; no `capacity` route is
  introduced.
- **Change** maps to the existing cluster and namespace **Events** surfaces.
  Events remain Kubernetes event views rather than an audit-history promise;
  `change` and `changes` are search aliases for the existing `events` ids.
- **Needs Attention** remains a separate cluster lens under Observe. It does not
  replace Overview, which continues to provide the broader cluster summary.
- Low-confidence application groups remain grouping-only when they do not carry
  a complete root object reference. Confidence does not manufacture identity;
  groups with a complete root may retain object-panel and table-to-map actions.
- **Fleet** includes open/selected clusters, whose per-cluster runtimes are
  already active. Merely configured clusters are not added to Fleet implicitly.
- Existing ids and labels remain canonical across the registry, sidebar,
  favorites, refresh mapping, and cluster/namespace dispatch. This preserves
  stored favorites without a migration while descriptions and search aliases
  expose the reconciled product language in the command palette.

### Phase 10: Extensible provider-owned query facets

- [x] Define the cross-layer facet descriptor contract before implementation,
      including stable keys, selection values, option values, exactness,
      high-cardinality/searchable behavior, and ownership of display metadata.
- [x] Replace the Status/Node-only typed-query transport and adapter plumbing
      with provider-declared facet selection and extraction while preserving
      `clusterId`, structural namespace scope, query identity, cursor identity,
      exact totals, and full-scope option stability.
- [x] Project provider facets through the existing generic GridTable
      `queryFacets` state so selections persist in table state and favorites
      without view-local filter implementations.
- [x] Migrate Pods, Workloads, and Nodes to the shared facet contract without
      changing their current Status/Node behavior, then remove the superseded
      one-off serializer and projection branches.
- [x] Add conformance tests that reject a published facet unless request
      serialization, backend execution, stable options, UI projection, and
      persistence all exist.

### Phase 11: Event and application triage facets

- [ ] Add backend-query Event Type, Reason, and Source facets to cluster,
      namespace, and All Namespaces Events, with options derived from the full
      structural scope rather than the current page or selection.
- [ ] Add backend-query Application Status, Confidence, and Has Issues facets to
      namespace and All Namespaces Applications using the existing backend-owned
      grouping status, evidence confidence, and needs-attention count.
- [ ] Keep high-cardinality Reason/Source options searchable and truthful when
      facet metadata is approximate or contributing sources are degraded.
- [ ] Preserve selections through favorites and cluster/namespace-scoped table
      persistence, without carrying selections across a different `clusterId`.
- [ ] Prove executor parity, exact/approximate option behavior, empty and
      permission-degraded states, focus-safe interaction, and rendered filtering
      before advertising the new capabilities.

## Validation

- Red/green/refactor for each behavior change.
- Focused Vitest for shell, favorites, command palette, resource-grid, and map.
- Focused Go tests for any new snapshot/query/rollup contracts.
- Frontend typecheck and relevant static contract tests per phase.
- Typed-query capability/facet conformance tests for every provider-declared
  facet and backend executor-parity tests across active selections.
- GridTable persistence, favorites, focus retention, and query-serialization
  tests for provider-owned facet controls.
- Browser validation for grouped navigation and new visual lenses.
- `mage qc:prerelease` on the final worktree, followed by `git status --short`.

## Open Questions

- Whether query providers or a frontend facet registry own labels,
  placeholders, searchability, and bulk-action presentation for generic facets.
- Whether Event Reason and Source facets stay exact at current event volumes or
  need an explicit metadata budget and approximate-options presentation.
- Whether Application Has Issues is a boolean facet over `needsAttention > 0`
  or a status-family selection derived from the backend grouping presentation.
