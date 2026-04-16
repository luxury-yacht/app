# Large Cluster Support Plan

## Intent

This plan describes the ideal architecture for large-cluster support in Luxury Yacht.

The goal is not to hide Browse pagination behind a nicer UI. The goal is to make Browse, and the catalog-backed surfaces around it, scale to clusters with many thousands of objects without unbounded frontend memory, full-catalog rescans on ordinary interactions, or fragile client-side merge behavior.

The right architecture is:

- a canonical per-cluster catalog
- an indexed backend query engine
- separate row queries and metadata queries
- a server-backed windowed Browse datasource
- a datasource-first table foundation
- invalidation-based streaming instead of client-side full-list merging

This is a no-compromise end-state plan. Implementation may still be phased, but the final architecture should not preserve legacy Browse-only abstractions, a permanent dual table contract, or any design we already expect to replace later.

## Core Principles

- Keep every catalog and object reference fully multi-cluster aware.
- Treat Browse as a query product, not as a special `GridTable` trick.
- Keep pagination as a transport detail, not a user-facing Browse concept.
- Bound frontend memory and CPU.
- Bound backend query work in steady state.
- Separate row-window concerns from metadata concerns.
- Preserve exact object identity everywhere: `clusterId`, `group`, `version`, `kind`, `namespace`, `name`, `uid`.
- Prefer explicit repair and degraded-state handling over silent drift.
- Prefer one durable datasource contract over parallel legacy and large-cluster table APIs.

## What Problem We Are Actually Solving

The current Browse model breaks down because it combines several expensive behaviors:

- the backend query path still full-scans and sorts the catalog per request
- Browse materializes one growing in-memory row array
- Browse sorts that array client-side
- the catalog stream path assumes the client can merge partial/full snapshots into one list
- sidebar and filter metadata are coupled to catalog snapshot shape rather than to explicit metadata queries

DOM virtualization alone does not solve any of those issues. It only reduces rendered row count.

## Target Architecture

### 1. Per-Cluster Canonical Catalog

Each cluster should have its own catalog service with:

- one canonical object record per resource instance
- full object identity
- stable cluster ownership
- explicit catalog health and confidence state

The canonical record is the source of truth. Query indexes and metadata views are derived from it.

Required object identity:

- `clusterId`
- `clusterName`
- `group`
- `version`
- `kind`
- `resource`
- `namespace`
- `name`
- `uid`
- `scope`
- creation timestamp and any lightweight fields needed for Browse sorting/filtering

### 2. Indexed Backend Query Engine

The backend should expose a real query engine over the catalog rather than running a full scan for ordinary Browse requests.

The query engine should support:

- scope modes:
  - `cluster-scoped-only`
  - `namespaced-only`
  - `selected-namespaces`
- filters:
  - namespaces
  - kinds
  - search
- sorts:
  - `kind`
  - `name`
  - `namespace`
  - `age`
- stable pagination:
  - cursor
  - query version
- exact object lookup by canonical identity

The query engine should execute against precomputed orderings or indexes, not by rebuilding the full match set every time.

### 3. Separate Query Types

The backend should not force every consumer through one payload shape.

There should be at least three conceptual query types:

- Row query:
  returns a window of rows for Browse
- Metadata query:
  returns kinds, namespaces, namespace groups, counts, and other UI metadata
- Exact match query:
  resolves one object by full identity for object diff and similar workflows

This separation is load-bearing.

Sidebar namespace metadata must not depend on whichever Browse row window was fetched most recently.
Filter dropdown metadata must not require the frontend to materialize all result rows.
Command palette and object diff should remain bounded lookup consumers, not Browse clones.

### 4. Explicit Query Contract

The row-query contract should include:

- `queryKey`
- `queryVersion`
- `cursor`
- `totalCount`
- `rows`
- `sort`
- `rangeStart`
- `rangeEnd`
- invalidation reason when a cursor is no longer valid

The metadata-query contract should include:

- `queryKey`
- `queryVersion`
- `totalCount`
- available kinds
- available namespaces
- namespace groups for navigation
- any degraded-state indicators needed by the UI

### 5. Invalidation-Based Streaming

Catalog streaming for Browse should stop trying to ship client-mergeable row snapshots.

The stream should instead act as an invalidation and repair channel:

- query state changed
- metadata changed
- visible windows stale
- dropped watch events occurred
- index confidence lost
- full repair required

The frontend then refetches visible row windows and metadata deliberately.

This is safer and more scalable than trying to keep a large merged client-side list coherent under churn.

### 6. Windowed Frontend Datasource

Browse should own a datasource, not a raw row array.

The datasource should expose something like:

- `rowCount`
- `getRow(index)`
- `isRowLoaded(index)`
- `requestRange(start, end)`
- `sort`
- `filters`
- `metadata`
- `loadingRanges`
- `degradedState`

Internally it should maintain:

- active query identity
- active query version
- loaded page cache
- outstanding requests
- page eviction policy
- stale/invalidation tracking

### 7. Datasource-First Table Foundation

The table layer should be datasource-first, not array-first.

Every tabular view should render through the same durable datasource contract. That contract must support both:

- eager finite datasets
- sparse windowed datasets

Typed views can still use eager data, but they should do so through an eager datasource adapter rather than through a separate permanent table API.

The datasource contract should support:

- `rowCount`
- `getRow(index)`
- `isRowLoaded(index)`
- `requestRange(start, end)`
- `getSortState()`
- `setSortState(...)`
- `getFilterState()`
- `setFilterState(...)`
- `metadata`
- `loadingRanges`
- `degradedState`

The table foundation should support:

- virtualization by `rowCount`
- placeholder rows for unloaded indexes
- visible-range notifications with overscan
- stable keyboard navigation and focus while rows hydrate
- context-menu and row-action safety when a row is not yet fully loaded
- eager finite rendering without forcing fake pagination or unnecessary placeholder behavior

This avoids building a second table architecture that we already know we would need to unify later.

## Browse in the Ideal Architecture

Browse becomes a thin consumer of the catalog query service.

### Cluster Browse

- query mode: `cluster-scoped-only`
- no namespace column
- rows fetched by visible window

### All Namespaces Browse

- query mode: `namespaced-only`
- namespace column shown
- no expansion to “all namespaces in the scope string”

### Namespace Browse

- query mode: `selected-namespaces`
- pinned to one namespace
- namespace column hidden

### Sorting

Browse sorting becomes entirely backend-driven.

Persisted sort state remains a frontend concern, but row ordering is owned by the backend query engine.

### Filters

Browse filters remain a frontend user concept, but they drive backend queries rather than local full-array filtering/sorting.

## Other Catalog Consumers

This architecture is broader than Browse, even though Browse is the main direct product change.

### Sidebar

Sidebar should consume catalog metadata, not Browse row windows.

Required change:

- stop inferring namespace groups from “the first populated `catalog` scope”
- move sidebar namespace data to an explicit metadata source

### Command Palette

Command palette should remain a bounded catalog search consumer:

- small result limit
- direct query to the backend query engine
- full object identity preserved for opening objects

It should not depend on Browse page cache state.

### Object Diff

Object diff should remain a bounded filtered-lookup consumer:

- kind/namespace/object pickers backed by metadata and bounded row queries
- exact fallback via canonical identity lookup

It should not adopt Browse virtualization.

### Favorites and Persistence

Favorites and Browse persistence should keep storing:

- filters
- sort
- column visibility
- widths

But the restored state must rehydrate into the new query-driven Browse datasource, not into a locally sorted full array.

### Other Typed Table Views

Typed views such as Pods, Nodes, Workloads, RBAC, Storage, and other feature-specific tables should converge on the datasource-first table foundation as well.

That does not mean they all need server-backed windowing. It means they should render through the same durable table abstraction, with eager datasource adapters where their data is already naturally finite and typed.

The no-compromise architecture is one table foundation with multiple datasource implementations, not one legacy array table plus one special Browse table path.

## Feature Mapping to the Current App

This section maps the target architecture directly onto the current feature surface of the app.

### Directly transformed features

- Cluster Browse:
  currently the cluster `browse` tab in `AppLayout` renders `BrowseView` over the `catalog` domain. In the target architecture it becomes a windowed row-query consumer in `cluster-scoped-only` mode.
- All Namespaces Browse:
  currently `AllNamespacesView` renders `BrowseView` for the `browse` tab. In the target architecture it becomes a windowed row-query consumer in `namespaced-only` mode.
- Namespace Browse:
  currently `NsResourcesViews` renders `BrowseView` for the `browse` tab. In the target architecture it becomes a windowed row-query consumer in `selected-namespaces` mode.

These are the features whose core behavior changes the most.

### Catalog-backed supporting features

- Sidebar:
  currently consumes `catalog` scoped state indirectly for namespace groups. In the target architecture it becomes an explicit metadata-query consumer and no longer depends on Browse row scopes.
- Command Palette:
  currently performs small bounded `catalog` searches and opens objects by full identity. In the target architecture it remains a bounded search consumer, but uses the new query engine directly rather than relying on current catalog snapshot assumptions.
- Object Diff:
  currently uses `catalog-diff` plus exact-match lookup. In the target architecture it remains a bounded lookup consumer backed by metadata queries, bounded row queries, and canonical exact-match resolution.
- Favorites:
  currently save and restore Browse filters, sort, and column state. In the target architecture the feature remains, but restoration targets the query-driven Browse datasource rather than a locally sorted full row array.
- Diagnostics:
  currently reports `catalog` and `catalog-diff` domain state in terms of snapshot/batch/truncation-oriented signals. In the target architecture it reports query cost, invalidation, degraded state, dropped events, and repairs.

These features keep their product role, but their data contracts move onto the new catalog/query architecture.

### Typed cluster views

The following features keep their existing typed refresh domains and typed payloads:

- Cluster Overview
- Nodes
- Config
- CRDs
- Custom
- Events
- RBAC
- Storage

In the target architecture:

- they do not become Browse
- they do not move onto catalog row queries
- they do move onto the datasource-first table foundation through eager datasource adapters where they use tables today

So their feature semantics stay the same, while the table/rendering foundation is unified.

### Typed namespace views

The following features also keep their existing typed refresh domains and typed payloads:

- Workloads
- Pods
- Autoscaling
- Config
- Custom
- Events
- Helm
- Network
- Quotas
- RBAC
- Storage

In the target architecture:

- they do not become catalog-query-driven Browse views
- they keep their typed feature-specific resource logic
- they render through eager datasource adapters on the datasource-first table foundation where applicable

### Object panel and object actions

Object opening and object actions remain anchored to full object identity.

That means:

- Browse row queries must return enough identity to open objects safely
- command palette search results must continue to return enough identity to open objects safely
- exact-match and action workflows must remain fully `clusterId` + GVK aware

The architecture changes how rows are fetched and cached. It does not relax object identity requirements anywhere.

### Refresh subsystem mapping

- `catalog`:
  becomes the query surface for Browse row queries and metadata queries
- `catalog-diff`:
  remains a separate bounded diff-oriented consumer
- typed cluster and namespace domains:
  remain separate and keep their current purpose

The refresh subsystem remains multi-domain. The difference is that the catalog-backed domains stop pretending one merged snapshot is the right universal shape for every consumer.

### What changes for users vs what changes under the hood

- User-visible behavior changes:
  - Cluster Browse
  - All Namespaces Browse
  - Namespace Browse
  - sidebar correctness and responsiveness on very large clusters
  - diagnostics signals
- Architectural changes with minimal intended UX change:
  - command palette catalog search backend
  - object diff catalog lookup backend
  - favorites/persistence restoration path
  - table foundation
  - refresh/catalog internals
- Intended to stay functionally the same:
  - typed cluster views
  - typed namespace views
  - object panel workflows
  - command palette as a feature
  - object diff as a feature

### Current feature to target architecture summary

| Current feature            | Current backing model                                                      | Target backing model                                                                      |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Cluster Browse             | `catalog` snapshot + client pagination + client sort                       | `catalog` row query windows + metadata query + backend sort                               |
| All Namespaces Browse      | `catalog` snapshot + namespace expansion + client pagination + client sort | `catalog` row query windows in `namespaced-only` mode + metadata query + backend sort     |
| Namespace Browse           | `catalog` snapshot + client pagination + client sort                       | `catalog` row query windows in `selected-namespaces` mode + metadata query + backend sort |
| Sidebar namespace tree     | incidental `catalog` snapshot metadata                                     | explicit metadata query consumer                                                          |
| Command Palette            | bounded `catalog` snapshot search                                          | bounded query-engine search consumer                                                      |
| Object Diff                | `catalog-diff` snapshot + exact-match helper                               | bounded diff query consumer + canonical exact-match helper                                |
| Typed cluster tables       | typed refresh domains + array-backed table state                           | typed refresh domains + eager datasource adapters                                         |
| Typed namespace tables     | typed refresh domains + array-backed table state                           | typed refresh domains + eager datasource adapters                                         |
| Object Panel opens/actions | full identity from current rows                                            | full identity from row queries and exact-match queries                                    |
| Diagnostics                | snapshot/batch/truncation-oriented telemetry                               | query/invalidation/repair/degraded-state telemetry                                        |

### Diagnostics

Diagnostics must evolve from batch/truncation language toward large-cluster signals:

- query latency
- rows scanned
- rows returned
- metadata query latency
- visible-window refetches
- cursor invalidations
- dropped watch events
- dirty query state
- forced repairs
- index rebuild cost
- informer promotion cost

## Backend Design Details

### Index Ownership

Use a single-writer model for mutable query indexes where possible.

That reduces race complexity and makes repair logic easier to reason about.

### Incremental Maintenance

Watch updates should update indexes incrementally.

If confidence is lost:

- mark query state dirty
- expose degraded state
- rebuild indexes from canonical catalog state

Do not silently continue as if nothing happened.

### Discovery and RBAC

Large clusters are often CRD-heavy and permission-heavy.

The architecture should include:

- cached discovery
- cached RBAC list/watch decisions
- explicit invalidation paths
- telemetry for discovery and RBAC cost

### Informer Promotion

Informer promotion should become resource-aware rather than threshold-only.

It should consider:

- object count
- churn
- resource importance for active queries
- memory budget

## Frontend Design Details

### Query Identity

The frontend query key should include:

- `clusterId`
- browse scope mode
- selected namespaces
- search
- kinds
- sort key
- sort direction

Pages from different queries must never collide.

### Page Cache

The page cache should be bounded and evict distant pages.

It should support:

- visible-window fetch
- overscan prefetch
- stale request cancellation or ignore
- clean reset when query identity changes

### Placeholder Semantics

Rows that are not loaded yet should be explicit placeholders, not “missing rows”.

That distinction matters for:

- keyboard navigation
- selection
- context menus
- focus restoration

### Loading and Degraded State

Browse should present:

- initial load
- partial load
- background refetch
- degraded but usable
- repair in progress

Those states should be deliberate, not accidental side effects of transport behavior.

## Phased Implementation

No runtime feature flags are planned. This should be implemented in phases, with the current Browse behavior preserved until final cutover.

### Phase 1: Freeze Contracts

- Write the exact backend row-query contract.
- Write the exact metadata-query contract.
- Write the exact cursor/query-version contract.
- Write stream invalidation semantics.
- Define which catalog consumers use which query types.

Stop/go checkpoint:

- contracts are stable enough to build against
- cross-app consumer responsibilities are clear

### Phase 2: Build the Backend Query Foundation

- Introduce canonical query modes.
- Add server-side sort support.
- Add stable cursor/query-version behavior.
- Add metadata-query support.
- Keep exact-match lookup correct.
- Add telemetry for query cost and invalidation.

Stop/go checkpoint:

- the backend query engine is correct under reference-oracle comparison
- query contracts are ready for frontend integration

### Phase 3: Build Incremental Index Maintenance and Repair

- Replace full rebuild on ordinary watch flush with incremental maintenance.
- Add dirty-state tracking.
- Add explicit rebuild paths.
- Add telemetry for watch loss, rebuilds, and degraded state.

Stop/go checkpoint:

- replayed mutation workloads match the full-scan oracle
- repair paths behave correctly under dropped updates

### Phase 4: Add Frontend Datasource and Sparse Table Support

- Add Browse datasource state.
- Replace the table contract with a datasource-first foundation.
- Add eager datasource adapters for existing typed views.
- Add sparse windowed datasource support for Browse.
- Add placeholder-row rendering and visible-range callbacks.

Stop/go checkpoint:

- datasource-first table behavior is stable
- focus/navigation/context menus still behave correctly

### Phase 5: Rebuild Browse on the New Datasource

- Move Cluster Browse to row windows.
- Move All Namespaces Browse to row windows.
- Move Namespace Browse to row windows.
- Remove user-visible load-more behavior.
- Move Browse sorting fully backend-side.

Stop/go checkpoint:

- all Browse scopes are functionally correct
- frontend memory remains bounded during long sessions

### Phase 6: Migrate Metadata and Catalog Consumers

- Move sidebar to explicit metadata queries.
- Ensure command palette uses the new query engine as a bounded consumer.
- Ensure object diff uses metadata plus exact-match lookup correctly.
- Verify favorites and persistence restore correctly into query-driven Browse.
- Update diagnostics to the new model.
- Move typed table views onto eager datasource adapters so the app has one durable table foundation.

Stop/go checkpoint:

- non-Browse catalog consumers are correct
- typed tables and Browse share the same datasource-first table foundation
- no consumer still depends on old batch/continue/load-more assumptions

### Phase 7: Replace Stream Merge with Invalidation

- Convert Browse-facing catalog streaming to invalidation/refetch behavior.
- Remove client-side assumptions about merged full/partial row snapshots.
- Keep manual refresh semantics coherent.

Stop/go checkpoint:

- churn does not create fetch storms
- visible windows and metadata repair correctly after invalidation

### Phase 8: Validation and Cutover

- Validate on representative large clusters.
- Validate on CRD-heavy clusters.
- Validate on namespace-heavy clusters.
- Validate on high-churn clusters.
- Cut over only after the acceptance criteria are met.

Stop/go checkpoint:

- query latency, memory growth, and repair behavior are acceptable
- the team is comfortable making the new path the only Browse implementation

## De-Risking Strategy

### Keep the Oracle Until Confidence Is High

Maintain a slower full-scan reference implementation in tests while the indexed path is being built.

Compare:

- counts
- ordering
- row windows
- metadata
- invalidation behavior

### Use Replayable Fixtures

Build deterministic fixtures that cover:

- thousands of objects
- large namespace counts
- mixed cluster-scoped and namespaced resources
- CRDs
- updates
- deletions
- dropped watch events
- rebuild-after-loss-of-confidence

### Preserve Repair Paths

If indexes or cursors lose confidence:

- admit degraded state
- invalidate affected queries
- rebuild from canonical catalog state

Do not rely on silent self-healing assumptions.

## Benchmark and Validation Gates

The architecture is not complete until these gates pass on representative clusters:

- steady-state Browse row queries do not full-scan the catalog
- metadata queries are bounded and do not depend on loaded row windows
- frontend heap growth stays bounded during long scroll sessions
- rapid scroll does not leak page cache entries
- sort and filter changes do not materialize the full result set client-side
- watch bursts do not trigger repeated full rebuilds
- invalidation-driven refetch does not create fetch storms
- sidebar namespace rendering remains correct while Browse row windows are active
- command palette remains fast and opens the correct object identity
- object diff remains bounded and exact-match lookup stays correct
- favorites restore the intended Browse query state after cluster/view navigation

## Test Strategy

### Backend

- indexed-query vs full-scan oracle comparison
- cursor invalidation tests
- metadata-query correctness tests
- exact-match lookup tests
- replayed mutation sequence tests
- degraded-state and repair tests

### Frontend

- Browse datasource tests
- datasource-first table foundation tests
- eager datasource adapter tests
- sparse windowed datasource tests
- scroll/window request tests
- stale-response handling tests
- persistence and favorite-restore tests
- sidebar metadata-consumer tests
- command palette bounded-query tests
- object diff lookup tests
- typed-view regression tests through eager datasource adapters

### Integration

- Cluster Browse
- All Namespaces Browse
- Namespace Browse
- cluster switching
- manual refresh during churn
- object opening and actions from Browse and command palette

### Performance

Performance is part of correctness for this work.

A solution that is functionally correct but still relies on full-catalog rescans or unbounded frontend row state is not complete.

## Risks

- The backend query/index redesign is a large change to a currently simpler catalog model.
- Replacing the table contract is a broader frontend change than a Browse-only patch, but keeping two permanent table contracts would be a worse long-term design.
- Sidebar can silently drift if metadata and row windows are not separated.
- Favorites and persistence can drift if sort/filter identifiers are changed without discipline.
- Command palette and object diff can regress even if Browse appears correct.
- Over-eager invalidation can produce refetch storms.
- Informer/index improvements can trade CPU for memory if not measured carefully.

## Open Questions

- Opaque cursors vs query-version-plus-range contract
- Exact metadata query shape for sidebar and Browse filters
- Whether one generalized index structure is sufficient or whether query-mode-specific materialized views are cleaner
- Exact shape and naming of the datasource-first table API
- How much invalidation detail should be surfaced to the UI vs handled internally

## Acceptance Criteria

- Cluster Browse smoothly scrolls through very large cluster-scoped result sets without user-visible pagination.
- All Namespaces Browse smoothly scrolls through very large namespaced result sets without materializing the full dataset client-side.
- Namespace Browse behaves the same way for pinned namespace queries.
- Browse sort and filter changes are backend-driven and do not require full client-side resorting.
- Frontend memory remains bounded during long Browse sessions.
- Backend steady-state query cost remains bounded without full-catalog rescans for ordinary visible-window fetches.
- Sidebar namespace data remains correct and is no longer implicitly coupled to Browse row scopes.
- Command palette remains a fast bounded catalog-search consumer.
- Object diff remains a bounded lookup consumer and exact-match resolution remains correct.
- Favorites, persistence, and object actions remain fully multi-cluster correct.
- Diagnostics clearly expose degraded state, invalidations, dropped events, and repairs.
- The app no longer has separate legacy array-table and Browse-specific table contracts to reconcile later.
