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
- [ ] Keep global status/owner/application filters disabled until their backend
      query projections exist.

### Phase 5: Namespace, application, and topology lenses

- [x] Expand the per-cluster namespace workload rollup into a broader aggregate
      domain for warning events, utilization, quota pressure, and degraded access.
  - [x] Add permission-honest warning-event counts, event-driven invalidation,
        and categorized sidebar badges.
  - [x] Add utilization and quota-pressure signals with explicit loading,
        available, unavailable, and stale-source presentation.
- [ ] Add confidence-bearing application grouping from owner links, Helm links,
      and explicit application labels.
- [ ] Add table-to-map and map-to-table navigation with complete object refs.
- [ ] Keep graph limits and partial/truncated presentation visible.

### Phase 6: Fleet lens

- [ ] Fan out over per-cluster overview/attention state in the frontend.
- [ ] Present cluster comparison rows with explicit `clusterId` identity.
- [ ] Switch cluster before navigating to a cluster-scoped lens or object.
- [ ] Cover mixed ready/loading/auth-failed cluster states.

## Validation

- Red/green/refactor for each behavior change.
- Focused Vitest for shell, favorites, command palette, resource-grid, and map.
- Focused Go tests for any new snapshot/query/rollup contracts.
- Frontend typecheck and relevant static contract tests per phase.
- Browser validation for grouped navigation and new visual lenses.
- `mage qc:prerelease` on the final worktree, followed by `git status --short`.

## Open Questions

- Whether the first Needs Attention surface replaces Cluster Overview or appears
  as a new lens. Start as a new lens to preserve current behavior while evidence
  is gathered.
- Whether application labels without owner/Helm evidence are navigable. Start as
  grouping-only with an explicit lower-confidence marker.
- Whether Fleet includes every configured cluster or only open clusters. Start
  with open/selected clusters because their per-cluster runtimes already exist.
