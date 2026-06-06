# Resource Table Simplification

Status: Active plan.
Created: 2026-06-05.

## Problem

Resource table display is split across too many partially shared paths. A
single cluster or namespace table can currently cross backend snapshot/query
code, refresh scope lifecycle, typed query hooks, resource-grid adapters,
table persistence hydration, view-local loading booleans, a loading boundary,
and the final `GridTable` empty renderer.

That split makes bugs like transient "No nodes found" hard to reason about:
there is no single owner for when rows are current, when stale rows may stay
visible, when a query has genuinely settled empty, or when a loading boundary
must suppress the table body.

This plan collapses resource inventory table display into one contract and
migrates existing views onto it.

## Target Model

Production resource inventory tables use one display owner:

```text
resource producer/source -> resource table controller -> ResourceInventoryTable -> GridTable
```

Views choose a descriptor and a source. They do not decide table display state.

The controller hook is `useResourceInventoryTable`. The wrapper component is
`ResourceInventoryTable`. Those names are intentional: after migration,
production cluster, namespace, Browse, Custom, and object-panel related-resource
inventory tables should enter through this controller/wrapper pair.

The resource table controller owns:

- table mode: `Local Complete`, `Local Partial`, `Query Backed Static`, or
  `Query Backed Dynamic`
- current rows and row identity
- source lifecycle state
- loading, loaded, refreshing, blocked, error, empty, partial, and degraded
  states
- filter, sort, search, and pagination publication
- empty-state eligibility
- visible/current-page export and action limits
- exact or approximate count/facet metadata
- stale-row retention rules for compatible refreshes

Allowed target resource inventory sources:

- `backendQuerySource` for backend-owned paged/query resource inventory tables,
  including typed resource queries, catalog-backed Browse/Custom queries,
  and high-cardinality cluster/all-namespaces resource tables
- `boundedRowsSource` for producer-proven bounded local resource inventory
  tables, including single-namespace complete/partial snapshots and
  owner/object-scoped related-resource tables

These are source adapters, not display paths. Both must emit the same source
state into `useResourceInventoryTable`.

`backendQuerySource` uses provider metadata:

```text
provider:
  typed-resource | catalog
```

The provider distinction remains because the backend producers are different.
Typed resource queries use typed snapshot table contracts. Catalog queries use
the object catalog as the identity/query owner, with Custom views setting
`customOnly=true` and hydrating only the current catalog page. The frontend
controller should not care which backend provider produced the page once the
source state is normalized.

Object-panel related resources such as Pods and Jobs stay on
`boundedRowsSource` while their owner-scoped domain keeps them naturally
bounded. They move to `backendQuerySource` only if a concrete defect or
measured fanout risk proves the local owner-scoped source is no longer correct.

`complete` and `partial` are not display paths. They are truthfulness metadata
on source state:

```text
completeness:
  complete | partial

partial reason:
  truncated | recent-window | log-buffer | degraded | owner-scoped-window
```

`boundedRowsSource` is allowed only for producer-proven bounded resource
inventory tables. It is not a general escape hatch for high-cardinality tables.

Direct `GridTable` use remains allowed only for classified non-resource
inventory exceptions such as parsed logs, diagnostics, settings, and
object-scoped recent events.

The old query-backed fallback flag `retainLocalRowsForEmptyQuery` is not part
of the target model. It is a temporary symptom patch and must be deleted once
backend query source ownership and empty-state settlement are centralized.

## Non-Goals

- Do not force logs, diagnostics, settings, or app-shell tables through the
  resource inventory controller.
- Do not force non-resource-inventory tables into backend query mode. Resource
  inventory tables move to the shared controller; query-backed inventory tables
  use `backendQuerySource`, and producer-proven bounded inventory tables use
  `boundedRowsSource`.
- Do not change visible product behavior unless required to remove false empty,
  partial, stale, or loading states.
- Do not add a new table component that bypasses `GridTable`.

## Current Inventory

Current production table display baseline, verified on 2026-06-05:

- 19 production screens render table data through `ResourceGridTableView`.
- 3 production data-table surfaces render `GridTable` directly outside
  `ResourceGridTableView`: object-panel events, parsed logs, and
  `ObjectPanelResourceGridTableSurface`.
- 6 production resource-grid adapter families feed table props:
  `useClusterResourceGridTable`, `useNamespaceResourceGridTable`,
  `useObjectPanelResourceGridTable`, `useQueryResourceGridTable`,
  `useQueryBackedClusterResourceGridTable`, and
  `useQueryBackedNamespaceResourceGridTable`.
- 2 shared resource-grid sublayers are crossed by multiple adapter families:
  `useResourceGridTableCommon` and `useGridTableBinding`.

Counting path families, current production table rendering requires reasoning
about 8 entry/display paths:

1. cluster local resource-grid adapter
2. namespace local resource-grid adapter
3. object-panel resource-grid adapter
4. catalog/pre-queried resource-grid adapter
5. cluster typed-query-backed adapter
6. namespace typed-query-backed adapter
7. `ResourceGridTableView` loading-boundary wrapper
8. direct `GridTable` bypasses

That count is before backend producers, refresh lifecycle, data access,
resource stream state, table persistence, sorting, filtering, virtualization,
or final `GridTableBody` empty rendering are considered.

Current production resource table render path details:

- 19 cluster, namespace, and Browse screens render through
  `ResourceGridTableView`.
- Cluster and namespace resource views choose their own `boundaryLoading`,
  `loaded`, `loading`, `emptyMessage`, and sometimes overlay behavior.
- Query-backed cluster and namespace views go through
  `useQueryBackedClusterResourceGridTable` or
  `useQueryBackedNamespaceResourceGridTable`, which then wrap the local
  resource-grid adapters.
- Direct `GridTable` use exists in object-panel events, parsed logs, and
  object-panel related-resource surfaces.

Current adapter families to collapse or classify:

- `useClusterResourceGridTable`
- `useNamespaceResourceGridTable`
- `useObjectPanelResourceGridTable`
- `useQueryResourceGridTable`
- `useQueryBackedClusterResourceGridTable`
- `useQueryBackedNamespaceResourceGridTable`
- `ResourceGridTableView`
- direct `GridTable` bypasses

The durable mode and large-data rules remain in
`docs/frontend/gridtable.md` and `docs/architecture/large-data.md`.

Current backend resource inventory query baseline, verified on 2026-06-05:

- 17 production snapshot payload structs carry table-query metadata such as
  cursor invalidation, totals, facet exactness, issues, or dynamic revision:
  cluster Config, CRDs, Events, RBAC, Storage; namespace Autoscaling, Config,
  Events, Helm, Network, Quotas, RBAC, Storage, Workloads; Nodes; Pods; and
  Catalog.
- 15 production typed snapshot builder files call `applyTypedTableQuery`.
  Namespace Workloads and Catalog have their own query execution path.
- Catalog-backed Browse and Custom use `CatalogSnapshot` plus page hydration
  through `HydrateCatalogCustomRows`, not the typed snapshot payload shape.
- Query-wide CSV/export exists for catalog selections only. Typed resource
  inventory tables currently have visible-row CSV/action semantics.
- Existing resource-stream and local snapshot domains may still feed other
  consumers, metrics, detail surfaces, diagnostics, refresh health, and
  producer-proven bounded table sources. Query-backed migrations must not keep
  an old local snapshot as an alternate display path for the same table.

Current backend code families to normalize or classify:

1. typed snapshot table query builders and per-domain payload structs
2. catalog query snapshot payload and query store
3. custom current-page hydration
4. producer-proven bounded local snapshot paths
5. object-panel related-resource local/derived data paths

## Target Inventory

When this plan is complete, production resource inventory table display has
one entry/display path:

```text
source adapter -> useResourceInventoryTable -> ResourceInventoryTable -> GridTable
```

Target production counts:

- resource inventory display paths: 1
- resource inventory source adapters: 2 (`backendQuerySource`, `boundedRowsSource`)
- backend resource inventory query result envelope: 1 for backend-query tables
- backend resource inventory query providers: 2 (`typed-resource`, `catalog`)
- production `ResourceGridTableView` resource consumers: 0
- production query-backed resource-grid wrappers:
  `useQueryBackedClusterResourceGridTable` and
  `useQueryBackedNamespaceResourceGridTable`: 0
- production migrated views with local `boundaryLoading`, `loaded`,
  table-body `loading`, fallback, or empty eligibility decisions: 0
- direct `GridTable` resource-inventory bypasses: 0
- direct `GridTable` non-resource-inventory exceptions: classified and listed
  in the enforcement test

The target source adapters are not display paths. They own data-source
semantics only:

1. `backendQuerySource`
2. `boundedRowsSource`

`backendQuerySource` covers:

- typed-resource provider: Nodes, Events, cluster resource families,
  all-namespaces Pods/Workloads, and other high-cardinality typed
  snapshot-query tables
- catalog provider: Browse, cluster Custom resources, and namespace Custom
  resources

`boundedRowsSource` covers:

- producer-proven single-namespace complete/partial resource snapshots where
  keeping local UX is correct
- object-panel related Pods and Jobs while their owner-scoped domain keeps
  them naturally bounded

Custom views should not use the current typed resource backend contract by
pretending arbitrary CRD fanout is a fixed typed snapshot table. They should
use `backendQuerySource` with the catalog provider because the object catalog
owns custom-resource identity, `customOnly` filtering, facets, cursor paging,
and query-wide catalog CSV. This keeps one frontend source shape without
duplicating catalog indexing in typed snapshot builders.

Source state carries complete, partial, and owner-scoped truthfulness metadata
instead of forcing separate display paths. Examples:

- complete: single-namespace Workloads when the producer owns the full
  namespace-scoped set; object-panel related Pods/Jobs when the relation is
  owner-scoped and not namespace fanout
- partial: any backend query result or bounded local snapshot whose producer
  reports truncation, capping, degradation, permission limitation, or a
  recent/windowed source

Complete source states may truthfully expose exact local-page and query-wide
metadata according to their producer. Partial source states may expose
operations only over the loaded/query-supported window and must present that
limit in shared render state.

Parsed logs and object-scoped recent events are direct non-resource-inventory
exceptions unless this plan later chooses to migrate them. They do not justify
separate resource inventory source shapes.

Progress is judged by reducing old display paths to zero, not by adding the new
controller while leaving the old adapter stack in place.

## Progress Scoreboard

Keep this scoreboard current as phases land.

| Measure                                                   | Start                     | Target             | Current                    |
| --------------------------------------------------------- | ------------------------- | ------------------ | -------------------------- |
| Resource inventory display paths                          | 8                         | 1                  | 8                          |
| Production `ResourceGridTableView` render sites           | 19                        | 0                  | 19                         |
| Production direct `GridTable` resource-inventory bypasses | 1                         | 0                  | 1                          |
| Production direct `GridTable` non-resource exceptions     | 2                         | classified         | 2 unclassified             |
| Query-backed resource-grid wrapper families               | 2                         | 0                  | 2                          |
| Local/catalog/object-panel resource-grid adapter families | 4                         | 0 as display paths | 4                          |
| Source adapters in target model                           | 0                         | 2                  | 0                          |
| Backend query result envelopes for query-backed tables    | 17                        | 1                  | 17                         |
| Backend query providers                                   | 2 implicit / 0 formalized | 2 formalized       | 2 implicit / 0 formalized  |
| Migrated views with view-local display decisions          | 19                        | 0                  | 19                         |
| Owner-safe backend query lifecycle tests                  | 0                         | 3+                 | 4                          |
| Static enforcement for new controller boundary            | 0                         | 1                  | 0                          |

Definitions:

- `Resource inventory display paths` counts alternate frontend paths that can
  decide loading, loaded, empty, pagination, or fallback behavior for resource
  inventory tables.
- `Direct GridTable resource-inventory bypasses` currently means
  `ObjectPanelResourceGridTableSurface`; it should migrate to the controller.
- `Direct GridTable non-resource exceptions` currently means object-scoped
  events and parsed logs; they may remain direct only after the enforcement
  test classifies them.
- `Migrated views with view-local display decisions` counts production
  resource views that still pass or derive `boundaryLoading`, `loaded`,
  table-body `loading`, query fallback, pagination controls, or empty-state
  eligibility.
- `Backend query result envelopes` means one normalized query envelope for
  `backendQuerySource` providers. Rows remain provider/domain projected types;
  bounded local snapshots are not forced through the backend query envelope.
- `Backend query providers` are currently implicit implementations:
  `applyTypedTableQuery` for typed snapshot families and
  `objectcatalog.Query` for catalog-backed Browse/Custom. The target is two
  formal providers behind the normalized backend query envelope.

## New Contract

### Backend Query Contract

All backend-query resource inventory tables use one normalized backend query
request and result contract. The current `ResourceQueryRequest` /
`ResourceQueryResult` may be evolved into this contract, but the final contract
must cover both typed-resource and catalog providers.

Required request identity:

```text
clusterId
provider: typed-resource | catalog
table
scope:
  cluster | namespace | all-namespaces
namespace when scope is namespace
filters:
  search, kinds, namespaces, provider predicates
sort:
  field, direction
page:
  limit, cursor
```

Required result shape:

```text
provider
table
queryIdentity
rows[]
page:
  limit, continue, previous, cursorInvalid
total:
  count, exact
facets:
  kinds, namespaces, statuses, nodes, exact
completeness:
  complete | partial
issues[]
dynamic:
  source, revision, policy
capabilities:
  sortable fields
  filterable fields
  searchable fields
  visible-row export allowed
  query-wide export allowed
```

Required row identity:

```text
clusterId
group
version
kind
resource
namespace
name
uid when available
provider-owned projected fields
```

Provider rules:

- `typed-resource` owns known Kubernetes resource family rows and may use
  domain-specific assemblers internally, but it must return the normalized
  result shape.
- `catalog` owns Browse and generic Custom resource rows. Custom hydration may
  enrich only the current page, but the page identity, totals, facets, cursor,
  and query-wide CSV semantics remain catalog-owned.
- Object-panel related resources are not migrated to backend query merely for
  uniformity. They stay on `boundedRowsSource` while their owner-scoped
  producer proves they are bounded. If that proof fails, the plan must be
  updated with the needed owner/object predicate contract before implementation.
- Provider-specific cursor encodings are allowed, but the frontend sees only
  the normalized page contract.
- Catalog streaming/readiness fields such as `batchIndex`, `batchSize`,
  `totalBatches`, `isFinal`, and `firstBatchLatencyMs` stay catalog provider
  internals and diagnostics metadata unless the controller explicitly needs
  provider readiness. Catalog `previous`/`hasPrevious` map into the normalized
  page contract; streaming batch fields are not table pagination fields.
- The result-shape target is one backend query envelope, not one row DTO.
  `rows[]` still contain provider/domain projected fields after the required
  identity fields.

### Source State

Every source adapter emits one source state object:

```text
identity:
  clusterId
  viewId
  scope
  domain/query identity when applicable
  owner token when lifecycle cleanup is possible

mode:
  Local Complete | Local Partial | Query Backed Static | Query Backed Dynamic

rows:
  current visible rows

lifecycle:
  idle | initializing | loading | ready | refreshing | blocked | error

settlement:
  current request identity
  current owner token
  has settled current identity
  can show empty for current identity
  can keep stale rows for compatible identity

metadata:
  total count and exactness
  facets and exactness
  pagination cursor state
  partial/degraded issues
```

The controller converts source state to render state. Empty UI is legal only
when the source has settled the current identity and says the current row set
is genuinely empty. A transient empty array from remount, persistence hydration,
query reset, stale request cleanup, metrics refresh, or scope ownership churn
must not reach `GridTableBody` as a user-facing empty result.

### Query Lifecycle

Backend query lifecycle must be owner-safe for every provider:

- an old component instance cannot disable, reset, or clean up the active query
  scope owned by a newer instance
- cleanup must be tied to request identity and owner identity, using owner
  tokens, reference counting, abort signals, or the smallest combination that
  proves old ownership cannot tear down new ownership
- stale request completion must not publish rows, errors, loaded flags, or empty
  settlement for a newer current identity
- stale request cleanup must not reset scoped refresh state when the scope is
  now owned by a newer query source
- rows from a previous compatible identity may remain visible during refresh
  when that is more accurate than showing empty
- incompatible identity changes must show loading or a deliberate reset state,
  not a false empty state

Decision: fix ownership with source-owned request tokens plus ref-counted
refresh-runtime scoped leases. Abort signals cancel transport, but abort alone
is not the ownership mechanism. A source adapter acquires a scoped lease for
the exact `clusterId` and query identity; cleanup releases only the matching
owner token and only resets the scope when no current owner remains. Request
completion publishes rows, errors, loaded flags, and empty settlement only when
the current source identity and owner token still match.

The token is owned below views, by `backendQuerySource` and the refresh/data
access layer. Views do not create or interpret owner tokens. That avoids a
view -> source -> view lifecycle cycle and keeps the fix provider-agnostic for
typed-resource and catalog requests.

This contract must be proven before removing any Nodes-specific workaround.
`boundedRowsSource` does not acquire backend query leases, but it must still
publish source identity with `clusterId` and may retain stale rows only for the
same compatible cluster/scope identity.

### Stream And Domain Coexistence

Migrating a resource inventory table to a shared source adapter does not
automatically delete every existing refresh or stream domain. For each table,
decide and document whether the old domain is:

- retired from table display but retained for streams, metrics, diagnostics,
  object panels, or detail surfaces
- converted into the backend query provider implementation
- removed entirely after all consumers migrate

Rules:

- Resource stream rows and query result rows must keep the same canonical
  object identity.
- Metrics demand must remain correct for Pods, Workloads, and Nodes after table
  display moves to the shared source/controller path.
- Manual refresh and diagnostics must point users at the query-backed table
  source, not a retired local table payload.
- A stale local snapshot/stream must not overwrite, clear, or race the active
  backend query result.

### Capabilities, Export, And Actions

Backend providers must publish table capabilities with the query result. The
frontend must not infer global capability from visible rows.

Required capability decisions per table/provider:

- sortable fields
- filterable fields
- searchable fields
- visible-row CSV/export
- query-wide CSV/export
- exact or approximate totals/facets
- allowed row actions
- whether query-wide selection is available

Rules:

- Destructive actions operate only on concrete visible-row refs unless a
  separate product and security plan approves query-wide mutation.
- Catalog query-wide CSV/export must execute through the backend using the same
  `clusterId`, provider, table, scope, filters, predicates, and sort as the
  visible query.
- Typed-resource providers default to visible-row CSV/export only in this
  migration. Typed query-wide export is out of scope unless a provider-specific
  backend export implementation is explicitly added with tests.
- If a provider cannot globally sort or filter a field, the field must not be
  advertised as globally sortable/filterable.

### Persistence And Query Identity

Migrating the table path must preserve or deliberately migrate persisted table
state:

- view id
- cluster id
- namespace or object scope
- provider and table
- filters and namespace filters
- sort key and direction
- page size
- column visibility and widths

Rules:

- Existing `viewId` strings, registry entries, and storage key semantics are
  preserved verbatim unless a migration test explicitly covers a rename.
  Swapping a table to `ResourceInventoryTable` must not reset user column
  widths, sort, filters, or page size.
- Persisted sort/filter keys that are not supported by the provider capability
  contract must be pruned before the query runs.
- Cursor state is not durable table state. Changing filters, sort, provider,
  table, scope, namespace, object ref, or page size starts a fresh query.
- Query identity must include `clusterId`, provider, table, scope, filters,
  predicates, sort, page size, and dynamic revision when the provider says the
  cursor depends on it.

### View Boundary

Cluster and namespace views should pass descriptors and source inputs only.
They should not pass these props directly:

- `boundaryLoading`
- `loaded`
- table-body `loading`
- query fallback flags
- manually derived empty-state eligibility
- pagination controls assembled outside the controller

After a view migrates, these are forbidden in that view unless the code is a
classified non-resource-inventory exception:

- deriving table display state from raw `rows.length`
- choosing whether an empty message is allowed
- deciding whether stale rows can remain visible
- assembling query pagination controls outside the controller
- combining local and query rows as a view-specific fallback

## Phases

### Phase 0: Lock The Evidence

- [x] Add a deterministic regression for the remount false-empty class.
      Implemented at the lifecycle layer (no visual timing): `orchestrator.test`
      `keeps a leased scope enabled across an old instance unmount (remount
      race)` proves an old instance's release cannot disable a scope a newer
      instance still leases; `refreshRuntime.test`
      `reference-counts scoped leases...` proves the counting; the existing
      `ClusterViewNodes.test` `keeps local node rows visible when a remount
      query temporarily returns empty` keeps the view-level retention path.
- [x] Cover a second query-backed typed table at the lifecycle layer: the
      orchestrator remount-race and `ignores a direct disable while a lease is
      held` tests both use the `pods` (all-namespaces) domain, so the fix is not
      Nodes-specific.
- [x] Trace and document the typed query producer/consumer ordering: backend
      request via `requestRefreshDomainState` (query scope, `preserveState:false`,
      `cleanup:true`) → refresh runtime scope enablement (now lease-counted) →
      `useScopedRefreshDomainLifecycle` lease acquire/release → `useTypedResourceQuery`
      per-instance rows (guarded by `cancelled` + `queryIdentityRef`) → table
      loading/loaded/empty derivation → `GridTableBody`. Root cause: last-writer-wins
      `scopedEnabledState` let an old unmount disable the `liveScope` a newer
      mount owned, starving the typed query of warm backend data.
- [x] Implement the lifecycle decision: ref-counted refresh-runtime scoped
      leases (`refreshRuntime` `acquire/releaseScopedLease`, orchestrator
      `acquire/releaseScopedDomainLease`, data-access `acquire/releaseRefreshDomainLease`,
      `useScopedRefreshDomainLifecycle` now leases). Source-owned request
      identity already exists in `useTypedResourceQuery`; abort/`cancelled` is
      used only for request cancellation, not ownership.
- [x] Prove that old query cleanup cannot disable, reset, or publish settlement
      into a new owner, and that there is no view/source/token cycle: a direct
      disable is suppressed while any lease is held (`orchestrator.test`); the
      lease/token lives below views in the runtime/data-access layer, so views
      never create or interpret tokens.
- [x] Mark the existing `retainLocalRowsForEmptyQuery` behavior as temporary.
      It stays until Phase 3 — the lease fixes the **concurrent** remount race,
      but a **cold sequential** remount can still settle empty before rows
      arrive, which needs the controller settlement layer.
- [x] Guard `retainLocalRowsForEmptyQuery` against cross-cluster staleness:
      retained rows must match the current `clusterId`
      (`useQueryBackedResourceGridTable.test` covers it).
- [x] Backend inventory: 17 typed payload structs carry table-query metadata;
      15 call `applyTypedTableQuery` (Namespace Workloads + Catalog have their
      own execution paths). Typed-resource contract:
      `ResourceQueryRequest`/`ResourceQueryResult`/`ResourceQueryRow`/`...Facets`/
      `...Issue`/`...DynamicRef` in
      `backend/refresh/snapshot/resource_query_contract.go`. Catalog contract:
      `objectcatalog.QueryOptions`/`QueryResult` (`backend/objectcatalog/query.go`)
      surfaced via `CatalogSnapshot` (`catalog.go`) + `HydrateCatalogCustomRows`
      (`app_object_catalog.go`). Query-wide CSV export is catalog-only
      (`ExportCatalogSelectionCSVFile` → `objectcatalog.WriteQueryCSV`, keyed by
      `QuerySelectionDescriptor`); typed tables have per-row actions / visible-row
      CSV only. `customOnly` gates catalog custom-only filtering. No formal
      `provider` type exists yet (implicit: `applyTypedTableQuery` vs
      `objectcatalog.Query`).
- [x] Table classification (target adapter):
      `backendQuerySource`/typed-resource — cluster Nodes, Config, Storage, RBAC,
      CRDs, Events; all-namespaces Pods, Workloads, Config, Network, Storage,
      RBAC, Quotas, Autoscaling, Helm, Events. `backendQuerySource`/catalog —
      Browse, cluster Custom, namespace Custom. `boundedRowsSource` —
      single-namespace Pods/Workloads (Local Complete) and single-namespace
      bounded resource views (Local Complete/Partial by producer stats), plus
      object-panel related Pods/Jobs (owner-scoped). Direct non-resource
      exceptions stay classified: object-panel events, parsed logs.
- [x] Fill in the scoreboard lifecycle-test row; remaining counts await the
      backend inventory and per-phase migration.

Acceptance:

- The failing tests reproduce the false-empty class without relying on visual
  timing.
- The test proves both sides of the gate: no false empty before settlement, and
  a real settled empty result still renders the empty state.
- Backend current state has no unknown provider, result-shape, stream/domain,
  export, action, or persistence baseline.
- No table enters Phase 3 or Phase 4 with an unknown source adapter target.

### Phase 1: Establish The Normalized Backend Query Contract

Decision (2026-06-06): **B1 — real backend canonical envelope.** Wails v2.12's
TS generator does not support Go generics, so the envelope is a concrete
embedded struct `ResourceQueryEnvelope` (in `resource_query_contract.go`). Each
per-domain result embeds it and adds a typed `Rows []DomainRow`; Go JSON
inlining flattens the envelope to top-level keys, so the frontend sees one
uniform shape plus provider-owned rows ("one envelope, not one row DTO").

The envelope uses **flat** facet fields (`kinds/namespaces/statuses/nodes/
facetsExact`) to match the existing typed payload wire, so the frontend reads
metadata unchanged and only the row field is renamed.

Per-domain migration recipe (proven on cluster-storage; mechanical for the rest):
1. Backend struct: embed `ResourceQueryEnvelope`, rename rows field to `Rows`
   (`json:"rows"`), drop its own `Continue/CursorInvalid/Total/TotalIsExact/
   Kinds/Namespaces/FacetsExact/Dynamic` (now from the envelope).
2. Builder (both query and truncated-window paths): populate `Provider`,
   `Table`, `Completeness` (`resourceQueryCompleteness(...)`), `Capabilities`
   (`newTypedResourceCapabilities(sortable, filterable, searchable)` matching the
   domain's `typedTableQueryAdapter`).
3. Update Go consumers/tests of the old row field (e.g. `cluster_domains_test.go`,
   `parity_test.go`).
4. Frontend payload interface: `extends ClusterMeta, ResourceQueryEnvelopeFields`
   with `rows: DomainEntry[]` (in `core/refresh/types.ts`).
5. Frontend row-field consumers (all renamed `<oldField>` → `rows`):
   `core/refresh/streaming/resourceStreamDomains.ts` (getRows/withRows/
   emptyPayload), the context selector (`clusterResourceDescriptors.ts` /
   namespace equivalent), `DiagnosticsPanel.tsx` case, the view `selectRows`,
   and test fixtures (`resourceStreamManager.test`, `resourceStreamDomains.test`,
   `queryBackedLeafFirstLoad.test`).
6. Regenerate Wails bindings only if a generated `wailsjs` type is imported
   directly (refresh/table path uses the hand-mirror, so usually not needed).

Risk finding: nodes/pods/workloads payloads are shared between the table and the
streaming/metrics path, so their migration also touches the metrics applicator
(data-correctness-critical). Static families first, streaming-metrics domains
last, validating after each.

- [x] Define the normalized backend query request and result DTOs. Landed:
      `ResourceQueryEnvelope` (flat facets), `ResourceQueryCapabilities`,
      `ResourceQueryProvider`/`Scope`/`Completeness`, `Provider`/`Scope` on
      `ResourceQueryRequest`, helpers `newTypedResourceCapabilities` /
      `resourceQueryCompleteness`, and conformance tests (`resource_query_contract_test.go`).
      Frontend mirror: `ResourceQueryEnvelopeFields` + `ResourceQueryCapabilities`
      in `core/refresh/types.ts`.
- [x] Cluster typed domains migrated end-to-end to the envelope + `rows`:
      **Storage, Config, RBAC, CRDs, Events** (5/17). Backend + frontend + all
      test fixtures green (`go test ./backend/refresh/snapshot ./backend/refresh/eventstream`,
      full frontend suite 3073 passing, typecheck, gofmt, prettier). Per-domain
      consumer set confirmed: backend struct/builder/capabilities + Go tests
      (cluster_domains_test, cluster_events_test, parity_test, eventstream
      handler); frontend payload interface, resourceStreamDomains collection,
      clusterResourceDescriptors select, DiagnosticsPanel case, view selectRows,
      and stream-manager/store/orchestrator/queryBackedLeafFirstLoad fixtures.
      Caution: shared stream-test files exercise both cluster and namespace
      scopes with identical accessor strings — edit cluster lines only.
- [x] All namespace typed domains migrated end-to-end (13/17): Config, Network,
      Storage, RBAC, Quotas, Autoscaling, Helm (5 payload sites incl. an empty
      one-liner and two build paths), Events. Backend + frontend + every fixture
      green (full frontend suite 3073, snapshot/eventstream Go tests, typecheck,
      gofmt, prettier, eslint). Note: the resource-stream test files build both
      the store payload (`data: {rows}`) AND a `fetchSnapshot` backend payload —
      both move to `rows`; the SSE/stream message format is separate and
      unchanged. namespace-custom + namespace-workloads stay (not migrated).
- [x] Metrics-coupled domains migrated — **17/17 typed domains complete**: Nodes,
      Pods, Workloads. These keep their domain-specific `metrics`/
      `metricsByCluster` fields alongside the embedded envelope + `rows`, and the
      consumer set additionally includes `metricsSnapshotApplicator` (all reads
      now `.rows`). **Name-collision hazard, now resolved:** the envelope's
      `Nodes []string` facet field shadows the old `Nodes` row field, so a stale
      `payload.nodes` consumer silently rebinds to the (empty) facet instead of
      failing to compile — `streaming_helpers.go`, `parity_test.go`, and the
      `DiagnosticsPanel`/orchestrator-test node reads each needed a manual
      `.nodes → .rows` sweep that typecheck/compile could NOT surface. Pods and
      workloads have no such facet, so their stale reads compile-error cleanly.
      Also: bulk line-scoped `\b(pods|nodes|workloads)\b → rows` perl must
      exclude domain string literals (`getScopedDomainState('pods', …)`) and the
      hyphenated `'namespace-workloads'` (the `\bworkloads\b` boundary matches
      after the hyphen) — both were corrupted and restored.
- [x] All 17 typed domains green together: backend (snapshot/eventstream/backend
      Go tests), full frontend suite (3073), gofmt, prettier, eslint.
- [x] Catalog provider migrated — **all 17 providers conformant (16 typed
      domains + catalog)**. The catalog
      does NOT embed `ResourceQueryEnvelope` (its `kinds` is the richer
      `[]KindInfo`, plus `previous`/`hasNext`/`hasPrevious`/batch pagination that
      collide on JSON keys), so it surfaces the new contract fields directly:
      `Provider: catalog`, `Completeness`, `Capabilities` (QueryWideExport:true +
      VisibleRowExport:true — the export distinction from typed providers). Its
      `items` field stays (per plan intent). Backend build + catalog tests green;
      frontend `CatalogSnapshotPayload` got the same three additive optional
      fields (can't extend `ResourceQueryEnvelopeFields` for the same `kinds`
      type reason). Sortable: name/kind/namespace/age/creationTimestamp;
      filterable: kinds/namespaces (from `normalizeCatalogQuerySortField`).
- [ ] Add typed-resource provider conformance tests for at least Nodes, Pods,
      Workloads, and one static family.
- [ ] Add catalog provider conformance tests for Browse and Custom.
- [x] Provider capability conformance tests added
      (`resource_query_contract_test.go`): a 16-entry typed-provider table asserts
      every typed domain publishes VisibleRowExport:true + QueryWideExport:false +
      non-empty sortable/searchable; the catalog asserts QueryWideExport:true.
      This table doubles as the conformance gate — a new typed domain must be
      added to it. (Still open: full per-domain snapshot conformance that drives
      the builders with fixtures, and action-semantics assertions.)
- [ ] Add cursor tests covering next, previous, invalid cursor, page-size
      changes, approximate totals, exact totals, and dynamic revision metadata.
- [ ] Add catalog query-wide export contract tests.
- [ ] Explicitly mark typed-resource query-wide export unsupported and
      visible-row only unless a separate provider export implementation is
      added with tests.
- [ ] Normalize catalog page metadata while keeping catalog batch streaming
      fields provider-internal or diagnostics-only unless the controller
      explicitly consumes provider readiness.

Acceptance:

- Both backend providers return the same normalized result shape.
- Provider capability metadata is the source of truth for frontend sortable,
  filterable, searchable, export, and action behavior.
- Custom resources use the catalog provider; generic Custom views do not use
  typed-resource fanout.
- The backend target is one query envelope for query-backed providers, with
  provider/domain projected row fields preserved.

### Phase 2: Introduce The Resource Table Controller

- [x] Added `useResourceInventoryTable` + render-state types in
      `frontend/src/modules/resource-grid/useResourceInventoryTable.ts`. The core
      is the pure `deriveResourceInventoryRenderState(source)` — a lifecycle →
      display projection (statuses: initializing/loading/refreshing/ready/empty/
      blocked/error) with React-free unit tests. Empty is decided from the
      lifecycle, never from a call-site `rows.length === 0`.
- [x] Added `ResourceInventoryTable` (`ResourceInventoryTable.tsx`) as the one
      resource-inventory wrapper around `GridTable`. Registered as a classified
      `resource-grid-surface` exception in the direct-GridTable enforcement
      contract test (it lives outside `shared/components/tables/`).
- [x] Loading boundary, settled-empty gate, partial/degraded label, refresh
      overlay, and pagination passthrough all live in the controller's render
      state; the wrapper only maps them onto the boundary + GridTable.
- [x] `GridTable` stays the rendering primitive — the wrapper adds no keyboard,
      focus, virtualization, filtering-UI, or context-menu behavior.
- [x] Controller lifecycle-matrix tests
      (`useResourceInventoryTable.test.ts`, 15 cases): initializing, cold
      loading, ready, refreshing-with-rows, refreshing-with-no-rows (the
      false-empty guard), settled empty, blocked, error, error/blocked
      precedence, Local Partial, complete-ignores-label, exact total,
      approximate total, cursor pagination, bounded null pagination.
- [x] `boundedRowsSource` + tests (`boundedRowsSource.test.ts`, 6 cases):
      Local Complete (exact, no label/pagination), Local Partial (window label),
      empty→settled-empty, still-filling→loading, blocked/error passthrough.
      Full frontend suite green (3094).

Acceptance:

- A source state object can be converted to a render state without consulting a
  cluster or namespace view component.
- Empty state is controlled by the render state, not by raw `rows.length`.
- Migrated views no longer pass `boundaryLoading`, `loaded`, table-body
  `loading`, query fallback flags, or manually derived empty-state eligibility.
- `backendQuerySource` and `boundedRowsSource` feed the same render-state
  contract.

### Phase 3: Replace Backend Query Resource Adapters

- [ ] Build `backendQuerySource` from the existing typed query hook, catalog
      query hook, and shared table state contracts.
- [ ] Normalize typed-resource and catalog query providers into the same source
      state shape before rendering.
- [ ] Make backend query source ownership safe across unmount/remount,
      stale-request cleanup, query identity changes, catalog pagination, and
      metrics-driven dynamic refreshes.
- [ ] Implement owner/request identity before changing view display behavior;
      do not add another per-view fallback to hide false empty rows.
- [ ] Migrate views one at a time behind `ResourceInventoryTable`. The old
      wrappers may coexist only as temporary compatibility shims until each
      migrated view is removed from them and the enforcement test is tightened.
- [ ] Migrate cluster query-backed views first:
      Nodes, Config, Storage, RBAC, CRDs, and Events.
- [ ] Migrate all-namespaces namespace query-backed views:
      Pods, Workloads, Config, Network, Storage, RBAC, Quotas, Autoscaling,
      Helm, and Events.
- [ ] Migrate Browse, cluster Custom, and namespace Custom through
      `backendQuerySource` using the catalog provider.
- [ ] Delete `retainLocalRowsForEmptyQuery`.
- [ ] Delete or reduce `useQueryBackedClusterResourceGridTable` and
      `useQueryBackedNamespaceResourceGridTable` to thin compatibility shims
      only while migration is in progress.

Acceptance:

- No migrated query-backed view computes its own `boundaryLoading`, `loaded`,
  empty eligibility, pagination controls, or query fallback behavior.
- Typed-resource and catalog-backed query tables enter the same frontend source
  shape.
- A partially completed Phase 3 is shippable for migrated views; unmigrated
  views remain on the old wrapper path until their own controller migration.
- Nodes and at least one other dynamic query-backed table pass the remount
  lifecycle regression.
- Catalog/Browse pagination passes the same stale-owner lifecycle regression.
- `retainLocalRowsForEmptyQuery` is removed, not expanded.

### Phase 4: Migrate Bounded Local Resource Tables To The Controller

- [ ] Migrate single-namespace Pods and Workloads to `boundedRowsSource` when
      producer stats prove the namespace-scoped set is complete or visibly
      partial.
- [ ] Migrate remaining single-namespace resource views that currently use
      bounded local data to `boundedRowsSource`, preserving `Local Complete`
      and `Local Partial` semantics from the large-data contract.
- [ ] Move partial copy, counts, filters, and action/export limits out of
      individual views and into shared controller render state.
- [ ] Migrate object-panel related Pods and Jobs to `boundedRowsSource` while
      their owner-scoped domain proves they are naturally bounded.
- [ ] Add bound-proof tests for single-namespace tables and object-panel
      related-resource tables. These tests must fail if a source silently fans
      out to namespace or cluster scale without reporting partial/degraded
      state.
- [ ] If any local resource inventory table cannot prove bounded complete or
      bounded partial semantics, stop and migrate that table to
      `backendQuerySource` with an explicit backend contract update.

Acceptance:

- No resource inventory table has a view-local display path.
- Single-namespace, owner-scoped, complete, and partial resource tables all use
  `boundedRowsSource` unless a concrete defect requires backend query.
- A producer-reported truncation or partial condition cannot be rendered as a
  normal complete table.
- For every migrated table, the old snapshot/stream domain is marked retained,
  converted, or retired, and no retired domain can clear the active table
  source.

### Phase 5: Classify Direct Exceptions

- [ ] Classify direct non-resource `GridTable` exceptions such as object-scoped
      recent events and parsed logs in the enforcement test.
- [ ] If a remaining resource inventory table cannot use `backendQuerySource`
      or `boundedRowsSource`, stop and update this plan rather than adding
      another frontend source shape or backend provider.

Acceptance:

- Remaining direct `GridTable` callers are classified non-resource-inventory
  exceptions, not untracked bypasses.

### Phase 6: Delete Old Paths And Enforce The New Boundary

- [ ] Remove `ResourceGridTableView` from cluster, namespace, Browse, and
      object-panel resource inventory consumers.
- [ ] Remove view-local table display booleans from migrated views.
- [ ] Collapse `useClusterResourceGridTable`,
      `useNamespaceResourceGridTable`, `useObjectPanelResourceGridTable`,
      `useQueryResourceGridTable`, and query-backed wrappers into source
      adapters plus shared binding helpers.
- [ ] Keep low-level reusable pieces such as persistence, sorting, filters,
      virtualization, and column factories where they belong.
- [ ] Add or update a static contract test that rejects new production
      resource inventory tables unless they use the new controller.
- [ ] Require direct `GridTable` exceptions to declare a reason and mode:
      logs, diagnostics, settings, object-scoped events, or another explicit
      non-resource-inventory category.
- [ ] Add static/backend contract tests that fail if a production
      `backendQuerySource` table exposes a non-normalized backend result shape.
- [ ] Add static/frontend contract tests that allow only
      `backendQuerySource` and `boundedRowsSource` as resource inventory source
      adapters, both through `ResourceInventoryTable`.
- [ ] Add persistence migration/pruning tests for stale sort/filter/page-size
      state.

Acceptance:

- There is one production resource inventory display path.
- New cluster/namespace resource tables cannot accidentally bypass the table
  mode and display-state contract.
- New backend-query resource inventory tables cannot bypass the normalized
  query result contract.

### Phase 7: Update Durable Docs

- [ ] Move the final resource inventory table contract into
      `docs/frontend/gridtable.md`.
- [ ] Update `docs/architecture/large-data.md` only for durable table-source
      and lifecycle rules, not temporary migration detail.
- [ ] Update `.agents/skills/browse-tables/SKILL.md` so future table work
      starts from the new controller and source adapter model.
- [ ] Update backend/refresh architecture docs so new resource inventory tables
      start from the normalized backend query provider contract.
- [ ] Delete this plan after all phases land and durable docs contain the
      permanent rules.

## Validation Plan

Focused checks while migrating:

```sh
npm run test --prefix frontend -- backendQuerySource useResourceInventoryTable ResourceInventoryTable
npm run test --prefix frontend -- useResourceInventoryTable ResourceInventoryTable
npm run test --prefix frontend -- useTypedResourceQuery useQueryBackedResourceGridTable
npm run test --prefix frontend -- useBrowseCatalog BrowseView ClusterViewCustom NsViewCustom
npm run test --prefix frontend -- ClusterViewNodes NsViewPods NsViewWorkloads
npm run test --prefix frontend -- gridTableViewRegistry.contract queryBackedLeafFirstLoad
npm run test --prefix frontend -- gridTablePersistence QueryPaginationControls
npm run typecheck --prefix frontend
```

Backend checks when query contracts or lifecycle assumptions change:

```sh
go test ./backend/refresh/snapshot ./backend/refresh/system ./backend/objectcatalog ./backend
```

Required contract coverage before implementation is complete:

- backend normalized query provider conformance tests for typed-resource and
  catalog
- frontend `backendQuerySource` lifecycle tests for typed-resource and catalog
- frontend `boundedRowsSource` render-state tests for complete, partial,
  owner-scoped, and same-cluster stale-row retention cases
- static tests proving production resource inventory tables use
  `ResourceInventoryTable`
- static/backend tests proving backend-query resource inventory providers return
  the normalized result shape
- persistence migration/pruning tests
- export/action capability tests, including typed-resource visible-row-only
  export capability and catalog query-wide export capability
- stream/domain coexistence tests for Pods, Workloads, Nodes, Browse, and
  Custom

Final gate for non-documentation implementation:

```sh
mage qc:prerelease
```

## Open Questions

- Should stale rows remain visible for all compatible backend-query refreshes,
  or only when the previous query identity matches except for dynamic revision?
- Should `ResourceInventoryTable` live in `modules/resource-grid` permanently,
  or graduate into `shared/components/tables` after migration?
- Which direct `GridTable` exceptions should remain classified outside resource
  inventory: object events, parsed logs, diagnostics, settings, and any others?
