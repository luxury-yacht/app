# Resource Row Wire and Frontend Efficiency

**Status:** Implemented; packaged-webview heap/transport measurements remain open

**Started:** 2026-07-21

**Scope:** Resource table row contracts, query-backed refresh demand, frontend
row retention, and the transport boundary used by resource-query pages.

## Outcome

Reduce all three costs of resource rows without changing user-visible behavior:

1. fewer bytes cross the backend/frontend boundary;
2. fewer identity values and row objects are retained by the frontend; and
3. unchanged refreshes cause less parsing, allocation, comparison, and React
   work.

The target is one complete `ResourceRef` per canonical Kubernetes object row, no
duplicate flat identity representation, query-only refresh demand that does not
retain a second bounded snapshot, and page-local structural sharing for
unchanged query results.

No phase may ship on an architectural promise alone. Each phase has correctness,
memory, payload, and latency gates. If a proposed optimization fails a gate,
remove that optimization and keep the last passing design.

## Why this work is cross-layer

`ResourceRef` currently carries `clusterId`, `group`, `version`, `kind`, and
optional resource/name/namespace/UID fields (`backend/resourcemodel/types.go:59-67`).
Concrete summary rows also serialize flat copies of several of those values; for
example Config, RBAC, Autoscaling, Storage, and custom-resource rows carry both
`ref` and flat identity fields (`backend/kind/streamrows/streamrows.go:125-199`,
`backend/kind/streamrows/streamrows.go:332-370`). Backend query adapters read the
flat projections for keys, filters, search, and sort
(`backend/refresh/snapshot/static_table_query.go:64-95`). The frontend base row
types expose the same projections (`frontend/src/modules/resource-grid/resourceGridTableTypes.ts:41-50`),
while the aggregated table contract separately requires a `ref`
(`frontend/src/modules/resource-grid/AggregatedResourceGridView.tsx:45-52`).

The repeated row-level cluster fields come from an embedded `ClusterMeta`, not
from isolated per-family declarations: `ClusterMeta` serializes `clusterId` and
`clusterName`, and its contract says every streaming row embeds it
(`backend/kind/streamrows/streamrows.go:33-38`). The same type also has distinct
backend context and once-per-payload-envelope roles
(`backend/refresh/snapshot/service.go:40-70`,
`backend/refresh/snapshot/service.go:167`); for example the Events payload
embeds `ClusterMeta` separately from each Event row
(`backend/refresh/snapshot/namespace_events.go:74-79`,
`backend/refresh/snapshot/namespace_events.go:107-127`). Removing flat
`clusterId` therefore requires an explicit decision about each `ClusterMeta`
role before the first family migrates.

The durable identity contract already says that flat fields are presentation and
compatibility projections while keys, navigation, panels, permissions, and
actions consume `ref` (`docs/architecture/shared-resource-model.md:59-65`). An
Event also has two intentionally different references: `ref` identifies the
Event, while `involvedObject` identifies its subject
(`docs/architecture/shared-resource-model.md:67-70`).

The documented `ResourceRef.resource` field is conditional descriptor/RBAC
metadata (`docs/architecture/shared-resource-model.md:53-54`), but two current
enforcement points require it on the rows in their scope: snapshot/stream parity
requires `Ref.Resource` to be non-empty
(`backend/refresh/snapshot/parity_test.go:199-218`), and hydrated custom rows
require the frontend wire ref's `resource` string
(`frontend/src/modules/browse/hooks/customCatalogRowAdapter.ts:29-47`). Phase 0
must resolve that contract mismatch and name both enforcement points in the
decision.

Query-backed tables currently acquire the same scoped refresh-domain lifecycle
used by snapshot consumers (`frontend/src/modules/resource-grid/useQueryBackedResourceGridTable.ts:250-259`).
Starting a stream performs a bounded snapshot reconciliation because streams
send change signals rather than rows (`frontend/src/core/refresh/orchestrator.ts:817-825`,
`backend/refresh/resourcestream/update_helpers.go:54-62`), and the resulting
payload is retained in scoped refresh state (`frontend/src/core/refresh/orchestrator.ts:1416-1429`).
The table itself derives liveness from signal clocks and deliberately avoids
payload-driven echo refetches (`frontend/src/modules/resource-grid/useQueryBackedResourceGridTable.ts:64-90`).

These dependencies mean row shape, backend query behavior, stream ordering,
refresh ownership, navigation identity, and frontend retention must be changed
as one contract rather than as isolated DTO cleanup.

## Non-goals

- Do not change table contents, ordering, filters, search, facets, pagination,
  cursors, exports, actions, navigation, object panels, empty states, or error
  presentation.
- Do not weaken the complete-reference or multi-cluster requirements.
- Do not remove the bounded snapshot path. Object panels, counts, and other
  consumers may still require it; Phase 0 must enumerate them before demand is
  split.
- Do not replace change-signal streams with row or positional-delta streams.
- Do not introduce a global ref/string intern pool. Its lifetime would outlive
  individual pages unless separately bounded and would add cross-scope aliasing
  and eviction behavior.
- Do not store a `row.key` field. Keys remain derived from the canonical ref so
  identity is not represented twice.
- Do not introduce MessagePack, CBOR, a custom dictionary protocol, a Web Worker,
  or a new dependency in the first implementation.
- Do not change metric collection or its join with resource rows.
- Do not aggregate multiple clusters into one refresh scope.
- Do not evict retained view state in a way that violates retained-first
  rendering.

## Target architecture

```text
Kubernetes informers / pollers
            |
            v
backend maintained row store
      |                    |
      | query demand       | snapshot demand
      v                    v
visible query page      bounded retained snapshot
      |                    |
      +--------- change clocks / readiness / permission --------+
      |
      v
transport row: { ref, presentation fields, facts }
      |
      v
validate once -> page-local structural share -> GridTable
                    |
                    +-- reuse ref for unchanged identity
                    +-- reuse entire row when every projected value is equal
```

### 1. One identity representation

Every canonical Kubernetes object row keeps one plain `ref` object containing
the complete cross-boundary identity. Remove flat `clusterId`, `group`,
`version`, `kind`, `namespace`, and `name` copies when they express the row's
own identity.

For this plan, a **canonical Kubernetes object row** is a wire row whose primary
identity is one concrete Kubernetes object and therefore belongs under the
`ResourceRef` contract. Operational records are outside that type set. In
particular, `nodemaintenance.DrainJob` identifies a drain invocation by
`clusterId` plus job `id` and has no Kubernetes object ref
(`backend/nodemaintenance/store.go:78-98`); its polling merge descriptor is not a
ref-only migration target. Phase 0 must classify every inventoried row family as
canonical-object or non-resource/operational before the reflection test's type
set is locked.

Backend query adapters, frontend columns, filters, sort helpers, exports, and
navigation must read those values through `ref`. Presentation-only data that is
not part of `ResourceRef`, such as a display cluster name or a short kind alias,
may remain only where the Phase 0 inventory proves it is required.

There is no compatibility period in which both representations remain
authoritative. Each migrated row family changes its producer, query adapter,
wire fixture, frontend type, and consumers in the same vertical slice.

#### `ClusterMeta` schema decision

The intended endpoint is to dismantle **row-level** `ClusterMeta` embedding,
not remove `ClusterMeta` indiscriminately:

- keep `ClusterMeta` as backend construction/context input and as once-per-scope
  payload-envelope metadata for canonical object payloads;
- keep `clusterId` on each row only inside `ref`;
- remove row-level `clusterName`, deriving display names from the workspace
  cluster registry above single-cluster refresh state; and
- allow a producer to receive `ClusterMeta` to build `ref` without embedding it
  into the resulting row.

Phase 0 must inventory and record this as a schema decision before Phase 1. If a
consumer cannot follow that endpoint, revise the decision centrally before any
family migrates; do not create a family-specific exception during rollout.

### 2. Separate query demand from snapshot demand

Introduce explicit demand modes on scoped refresh leases:

- **query demand** owns stream/poll liveness, source clocks, readiness,
  permission state, reconnect/reset handling, and the current retained query
  page;
- **snapshot demand** owns the existing bounded snapshot payload for consumers
  that need that representation.

The orchestrator activates the union of active demands for a scope. A table with
query demand alone must not fetch or retain a bounded snapshot merely to become
live. A simultaneous snapshot consumer must continue to receive snapshots, and
its payload applies must not trigger query echo refetches; query liveness remains
keyed to the domain's declared signal clocks.

The initial query page becomes query demand's reconciliation read. Establish an
explicit subscribe-before-query barrier so a mutation cannot fall between the
initial read and the live subscription. If a signal advances while a query is in
flight, discard or immediately revalidate the stale response using the source
clock contract. Poll-only domains use the same demand interface and refetch the
current page on their existing schedule.

The backend ordering half is equally load-bearing: invalidate the snapshot/page
cache before broadcasting the change signal. `resourcestream.Manager.broadcast`
currently performs invalidation before delivery
(`backend/refresh/resourcestream/manager.go:1036-1039`), the snapshot service
documents why a refetch inside its cache TTL otherwise receives pre-change data
(`backend/refresh/snapshot/service.go:465-471`), and the manager test pins the
ordering (`backend/refresh/resourcestream/manager_test.go:376-419`). The demand
split must preserve this rule for every current-page query source.

### 3. Page-local structural sharing

At the single typed-query ingestion boundary, compare an incoming page with the
previous page for the same cluster, domain, scope, query identity, and cursor:

1. build a temporary previous-row map by the canonical ref key;
2. reuse the previous `ref` object when the complete identity is equal;
3. reuse the previous row object only when every projected value is equal;
4. allocate a new row when any scalar, map, array, condition, metric, or
   presentation value changes; and
5. discard the temporary map after applying the page.

Use explicit per-family equality descriptors, generated equality, or another
exhaustive mechanism selected in Phase 0. A generic shallow comparison is not
sufficient for custom-resource labels/annotations/conditions or other nested
values. The current snapshot merge only shallow-reuses rows for three polling
payload descriptors (`frontend/src/core/refresh/snapshotMerge.ts:26-75`,
`frontend/src/core/refresh/snapshotMerge.ts:106-173`), so query-page sharing must
be implemented at query ingestion rather than extending that polling-only path.

Expected whole-row reuse is deliberately uneven. The initial expected target is
the Config, RBAC, and Storage families, whose row contracts carry projected
object/presentation fields rather than serve-time metric fields
(`backend/kind/streamrows/streamrows.go:125-199`). Pods join CPU/memory samples
onto served row copies (`backend/refresh/snapshot/pods.go:330-353`,
`backend/refresh/snapshot/pods.go:592-601`), while Workloads and Nodes also join
changing metric state at serve (`backend/refresh/snapshot/namespace_workloads.go:234-244`,
`backend/refresh/snapshot/nodes.go:167-191`); those rows should be expected to
allocate on metric ticks whenever projected values change, although their refs
can still be reused. Event rows can be reused while the Event object is
unchanged, but an updated most-recent timestamp changes `AgeTimestamp`
(`backend/resources/events/model.go:89-96`,
`backend/refresh/snapshot/namespace_events.go:107-127`). Evaluate and enable
whole-row sharing per family so lower reuse in dynamic tables is not interpreted
as a correctness failure or hidden by aggregate results.

Do not intern prefixes in the initial implementation. Prefix interning targets
cross-row repetition within one page, while whole-ref reuse targets the same row
across response generations; one does not make the other redundant. Whether
sharing strings such as group/version/kind/resource materially reduces retained
heap depends on the production JavaScript engine and payload mix, so use the
Phase 0 heap baseline to decide. Defer it until ref-only rows and demand splitting
are measured because it adds another page-lifetime strategy; if later evidence
supports it, test a bounded page-local prefix pool rather than a global pool.

### 4. Derived keys stay derived

Continue deriving row keys from the complete ref. Do not stamp the canonical key
onto every row: that would trade repeated construction for another retained
identity string. If measurements later show key construction is material, test a
bounded `WeakMap<ResourceRef, string>` at the row-key boundary; it may ship only
if it lowers render cost without increasing retained heap or weakening key
correctness.

### 5. Transport compression is conditional

The production transport is already traceable. The query hook calls
`requestRefreshDomainState` (`frontend/src/modules/resource-grid/useTypedResourceQuery.ts:418-455`),
which enables and requests the scoped refresh domain
(`frontend/src/core/data-access/dataAccess.ts:113-139`). The orchestrator calls
`fetchSnapshot` (`frontend/src/core/refresh/orchestrator.ts:1293-1299`), and that
client performs `fetch` against `/api/v2/snapshots/{domain}` on the resolved
loopback base URL (`frontend/src/core/refresh/client.ts:225-241`). The backend
registers that HTTP route and starts its listener
(`backend/refresh/api/server.go:54-70`,
`backend/app_refresh_setup.go:452-472`); backend guidance states that the native
Wails webview consumes this loopback HTTP server in production
(`backend/AGENTS.md:103-107`). Standard HTTP response compression is therefore
applicable to the production query path.

After structural reductions, evaluate standard negotiated compression at that
loopback HTTP boundary. Phase 0 still records actual packaged-webview negotiation,
middleware placement, and uncompressed/compressed baselines. Compression may
ship only if representative payload bytes fall further and encode/decode
latency, CPU, peak allocation, first-page latency, and cancellation behavior
pass the release gates below.

A page-level identity-prefix dictionary remains a deferred option. If evidence
eventually requires it, generate and decode it at the transport boundary so all
application code still receives complete plain `ResourceRef` objects. Do not
expose dictionary indices as application identity and do not implement this
while field removal, demand splitting, or standard transport compression meets
the targets.

## Phased implementation

### Phase 0 — Inventory, contract tests, and baselines

- [ ] Build a production inventory of every resource table family and record:
  backend producer/projector, maintained store, query adapter, snapshot builder,
  stream/poll source, frontend normalizer/type, columns, filters, sort, facets,
  export, row key, navigation, actions, panels, cache, and non-table snapshot
  consumers.
- [x] Classify each inventoried wire row as a canonical Kubernetes object row or
  a non-resource/operational record. Record the exact Go type that represents
  each canonical row and the reason for every exclusion; explicitly include
  `NamespaceSummary` and `objectcatalog.Summary`, and exclude
  `nodemaintenance.DrainJob` because it is an operation record without a
  `ResourceRef` (`backend/refresh/snapshot/namespaces.go:184-200`,
  `backend/objectcatalog/types.go:60-75`,
  `backend/nodemaintenance/store.go:78-98`).
- [x] Classify each scoped refresh consumer as `query`, `snapshot`, or both.
- [x] Trace stream subscription acknowledgement, initial reconciliation,
  in-flight query cancellation, replay, reset, reconnect, permission denial,
  polling fallback, scope teardown, and backend invalidate-before-broadcast
  ordering from producer to every consumer.
- [x] Record and approve the `ClusterMeta` schema decision: retain it for
  backend construction/context and once-per-scope payload envelopes, remove it
  from canonical Kubernetes object rows, keep row `clusterId` only in `ref`, and derive
  `clusterName` from the workspace registry. Name every affected merge-key and
  cross-cluster display consumer, including the current payload fallback in
  `frontend/src/core/refresh/snapshotMerge.ts:117-120`; revise the decision
  centrally before Phase 1 if the inventory finds a blocker.
- [x] Decide whether `ResourceRef.resource` is required for every canonical
  Kubernetes object row or remains conditional descriptor/RBAC metadata. Record consumers and update
  the parity helper (`backend/refresh/snapshot/parity_test.go:199-218`) and
  custom hydration adapter
  (`frontend/src/modules/browse/hooks/customCatalogRowAdapter.ts:29-47`) in the
  same Phase 1 slice if the decision changes their current requirement.
- [ ] Record the production loopback HTTP request/response path, packaged-webview
  `Accept-Encoding`/`Content-Encoding` behavior, compression middleware
  placement, cancellation, and response parsing.
- [ ] Add wire-shaped characterization fixtures for every row family. Fixtures
  must marshal through the Go producer and parse through the real frontend
  boundary rather than hand-building fields omitted by JSON.
- [x] Add contract tests covering full refs, cluster-scoped refs with no
  namespace key, HPA detail-serving identity, Event `ref` versus
  `involvedObject`, Helm synthetic identity, and custom-resource nested facts.
- [x] Add characterization tests for current table results across filters, sort,
  search, facets, pagination, anchors, exports, actions, and navigation.
- [x] Create reproducible 50, 250, and 1,000-row fixtures for at least Config,
  Events, Pods, Workloads, Nodes, and custom resources, with multiple clusters
  and namespaces represented.
- [ ] Record baseline uncompressed serialized bytes, production-transport bytes,
  Go query/encode time and allocations, frontend parse/apply time and
  allocations, retained heap after steady state, first-page latency, quiet
  refresh latency, and React commit/render counts.
- [x] Record baseline source line count for production row identity,
  normalization, and key/accessor code separately from tests and docs.
- [x] Write the demand-mode and subscribe-before-query contract as a focused
  test before changing orchestrator behavior; confirm the new tests fail for the
  intended reason.

**Exit criteria:** the inventory has no unclassified table or snapshot consumer;
the characterization suite passes on the current implementation; measurements
are reproducible with committed fixtures and recorded commands.

### Phase 1 — Migrate to ref-only row identity

Work in red/green/refactor vertical slices. For each slice, first change the
wire-contract test to require the ref-only shape and confirm it fails; then
change producer and consumers together.

- [x] Add shared backend ref accessors for query key/filter/sort/search code only
  where they remove repeated nested-field expressions across adapters.
- [x] Add one frontend identity accessor/adapter at the normalization boundary;
  do not create per-view fallback logic.
- [x] Migrate scalar static families first: Config, RBAC, Storage, Quotas,
  Network, Helm, and CRDs.
- [x] Migrate `NamespaceSummary`, including namespace lifecycle/readiness
  projections and the polling merge key that currently falls back from
  `entry.clusterId` to payload `clusterId`
  (`backend/refresh/snapshot/namespaces.go:184-205`,
  `frontend/src/core/refresh/snapshotMerge.ts:106-120`).
- [x] Migrate Autoscaling with a regression test proving its navigation ref
  reaches the typed HPA details/actions API identity.
- [x] Migrate namespace and cluster Events with tests proving the Event row ref
  and involved-object ref remain distinct and complete.
- [x] Migrate Nodes, Pods, and Workloads with metric-revision, stale-metric,
  server-side sort, and cursor tests.
- [x] Migrate `objectcatalog.Summary` across both Browse/catalog and
  `catalog-diff`, then migrate custom-resource rows, including cluster-scoped
  resources, hydration, labels, annotations, conditions, and age. The shared
  catalog row currently carries flat identity without `ref`, and the polling
  merge reads those fields directly (`backend/objectcatalog/types.go:60-75`,
  `frontend/src/core/refresh/snapshotMerge.ts:136-159`).
- [x] Remove migrated flat identity fields from Go structs, JSON fixtures,
  TypeScript row types, normalizers, query adapters, columns, and compatibility
  helpers in the same slice.
- [x] Add a required Go reflection-based contract test over the exact canonical
  Kubernetes object-row type set recorded by the Phase 0 inventory. Reject
  embedded row-level `ClusterMeta` and own-identity JSON fields alongside `ref`,
  with an explicit allowlist for semantic/presentation fields such as Event
  involved-object kind and Node software version that merely share an
  identity-like field name. Add a coverage assertion that every migrated family
  maps to one tested Go type; do not include non-resource records such as
  `nodemaintenance.DrainJob`.
- [x] Add frontend enforcement only where it catches a separate TypeScript
  regression. A Biome plugin is optional rather than the Go enforcement; if one
  is added, use repository-root-independent `**/`-anchored plugin includes like
  the existing plugin entries (`frontend/biome.jsonc:192-217`).
- [x] Update shared-resource-model and table architecture docs after all
  families pass.

**Exit criteria:** every canonical Kubernetes object-row type in the Phase 0
inventory crosses the boundary with one full own-object ref and is covered by
the reflection test; all recorded Phase 0 behavior is preserved; serialized
fixture size and frontend retained heap decrease; production source line count
for the affected identity path decreases.

### Phase 2 — Split query and snapshot refresh demand

Use red/green/refactor for each lifecycle behavior. Do not change the lease API
until the producer, all consumers, ordering guarantee, and regression test for
that behavior are named.

- [x] Extend scoped refresh leases with explicit query/snapshot demand and
  reference counts per cluster/domain/scope.
- [x] Keep readiness, permission, source clocks, stream health, and fallback
  state shared; keep query-page data separate from bounded snapshot payload.
- [x] Make query demand establish the live subscription before issuing its
  reconciliation query, or prove and test an equivalent race-free ordering.
- [x] Preserve and test backend invalidate-before-broadcast ordering for every
  signal-backed query domain so a signal-triggered current-page refetch cannot
  read a pre-change cached page.
- [x] Replace query-only initial bounded-snapshot reconciliation with the
  current-page query.
- [x] Preserve the existing bounded snapshot path whenever snapshot demand is
  nonzero.
- [x] Prove simultaneous query and snapshot demand starts one live source,
  serves both representations, and produces no payload-driven query echo.
- [x] Prove a signal during the initial/in-flight query cannot leave stale rows
  applied.
- [x] Preserve page-stable quiet refetch, replay, reset, reconnect, manual
  refresh, polling fallback, permission denial, partial permission, pause,
  background scope, and retained-first behavior.
- [x] Prove releasing query demand does not reset data still owned by snapshot
  demand, and releasing the last demand stops work and clears only the state
  required by the existing retention contract.
- [x] Update `data-freshness.md`, `refresh-system.md`, and `large-data.md` with
  the final ownership and ordering contract.

**Exit criteria:** query-only tables do not fetch or retain bounded snapshot row
payloads; snapshot consumers behave as recorded in Phase 0; request counts,
first-page latency, and quiet-refresh latency meet the release gates.

### Phase 3 — Add query-page structural sharing

- [x] Record expected reuse separately for static, event-churn, and
  metric-bearing families; do not use one aggregate reuse percentage as the
  acceptance result.
- [x] Add tests that an unchanged query response reuses the previous ref and row
  objects.
- [x] Add tests that any changed scalar, map, array, condition, metric,
  presentation, or identity value allocates the required new objects.
- [x] Add tests for reordering, page/cursor changes, filter/sort changes,
  cluster changes, namespace changes, deletion, insertion, replay, reset, and
  stale-response rejection.
- [x] Implement sharing once at typed-query ingestion, scoped to the previous
  page for the same full query identity.
- [x] Keep temporary indexes page-local and discard them after apply.
- [x] Feed the shared rows into the existing retained-page/cache path; do not
  create a second cache.
- [x] Confirm cell caches and memoized components receive stable row references
  for unchanged rows and new references for changed rows.
- [x] Disable whole-row comparison for any family where it does not reduce
  allocations and React work after comparison overhead; ref reuse may remain if
  it independently passes the same per-family gate.

**Exit criteria:** unchanged pages in enabled families reuse row objects;
changed nested values are never masked; each enabled family's apply allocations,
React work, and retained heap meet the release gates. Dynamic families are not
required to match static-family reuse rates.

### Phase 4 — Evaluate production transport compression

- [ ] Measure the ref-only payload on the production loopback HTTP transport
  before adding compression.
- [ ] Add focused red tests for packaged-webview HTTP negotiation, round-trip
  identity, cancellation, `304`/ETag behavior, streaming-route exclusion, and
  error propagation before adding loopback response compression.
- [x] Benchmark representative Events, Pods, and custom-resource pages at all
  fixture sizes with compression on and off.
- [x] Ship compression only if production-transport bytes decrease and every
  latency, CPU, allocation, peak-memory, stability, and cancellation gate passes.
- [x] If compression fails a gate, remove it and document the measurements.
- [ ] Consider a generated page dictionary only if the remaining measured wire
  cost misses an agreed target and standard compression cannot pass. Treat that
  as a separately reviewed protocol change with frontend/backend conformance and
  version-skew tests.

**Exit criteria:** either a measured transport optimization passes every gate,
or the phase closes with no transport codec change and preserved evidence for
why.

## Phase 0 decisions and inventory

### Canonical row type set

The Go reflection guard and Phase 1 release gate cover the following exact wire
row types. This list is the enforcement inventory; adding a new concrete object
row to the generated refresh contract requires adding it here or documenting a
non-resource exclusion.

| Surface/domain | Canonical Go row type | Notes |
| --- | --- | --- |
| Cluster/Global Namespaces | `snapshot.NamespaceSummary` | Namespace object row; joins `snapshot.NamespaceMetric` by full ref. |
| Namespace metrics | `snapshot.NamespaceMetric` | Already ref-only; retained in the guard so a flat identity cannot be added later. |
| Cluster Nodes | `streamrows.NodeSummary` | `version` is kubelet software display data, not API identity. |
| Cluster Attention | `snapshot.AttentionFinding` | One concrete Kubernetes object with one or more finding causes. |
| Browse, Custom, catalog-diff | `objectcatalog.Summary` | The catalog is the identity/existence authority; Phase 1 adds its canonical `ref`. |
| Cluster Config | `streamrows.ClusterConfigEntry` | Cluster-scoped object row. |
| Cluster CRDs | `streamrows.ClusterCRDEntry` | `group` is the CRD's described API group, not the CRD object's own API group. |
| Cluster RBAC | `streamrows.ClusterRBACEntry` | Cluster-scoped object row. |
| Cluster Storage | `streamrows.ClusterStorageEntry` | PersistentVolume row. |
| Cluster Events | `snapshot.ClusterEventEntry` | `ref` identifies the Event; `involvedObject` identifies its subject. |
| Namespace Config | `streamrows.ConfigSummary` | ConfigMap/Secret row. |
| Namespace Network | `streamrows.NetworkSummary` | Service/Ingress/EndpointSlice/NetworkPolicy/Gateway-family row. |
| Namespace RBAC | `streamrows.RBACSummary` | Role/RoleBinding/ServiceAccount row. |
| Namespace Storage | `streamrows.StorageSummary` | PersistentVolumeClaim row. |
| Namespace Autoscaling | `streamrows.AutoscalingSummary` | HPA ref uses the details/actions serving identity. |
| Namespace Quotas | `streamrows.QuotaSummary` | ResourceQuota/LimitRange/PodDisruptionBudget row. |
| Namespace Events | `snapshot.EventSummary` | Its `kind` projection is the involved-object kind and is an explicit semantic-field exception. |
| Namespace Helm | `snapshot.NamespaceHelmSummary` | Synthetic HelmRelease ref remains complete and canonical. |
| Pods and Object Panel Pods | `streamrows.PodSummary` | Same query row serves namespace and object-panel scopes. |
| Workloads | `streamrows.WorkloadSummary` | Deployment/StatefulSet/DaemonSet/Job/CronJob/standalone Pod. |
| Legacy namespace custom stream/diagnostics | `streamrows.NamespaceCustomSummary` | Production Custom tables use catalog plus page hydration, but the registered compatibility domain is still a wire producer. |
| Legacy cluster custom stream/diagnostics | `streamrows.ClusterCustomSummary` | Same compatibility classification as the namespace custom domain. |
| Catalog-page custom hydration | `snapshot.CustomResourceSummary` | Rich current-page status/metadata row. |
| Object Panel Events | `snapshot.ObjectEventSummary` | Object-scoped Event row; `involvedObject` remains distinct from its own ref. |

The following records are explicitly outside that reflection type set:

- `nodemaintenance.DrainJob` and `nodemaintenance.DrainEvent` are operation
  records identified by job/event ids, not Kubernetes object rows.
- cluster-overview/Global Clusters rows are aggregate cluster projections, not
  individual Kubernetes objects.
- `streamrows.PodAggregate`, `streamrows.EndpointSliceServiceFact`, and
  workload/node aggregate facts are backend-only join inputs, not wire rows.
- `streamrows.NodePodMetric`, `AttentionCause`, query facet rows, and catalog
  namespace groups are nested facts rather than independently actionable rows.
- object-map nodes are governed by the graph payload contract, and logs are
  governed by the bounded log-stream contract; neither is a resource table row.
- `resources/types.JobSimpleInfo` is a nested object-detail projection whose
  parent panel supplies cluster identity. The local Jobs table is inventoried
  for behavior characterization, but changing the object-detail schema is
  outside this refresh-row migration.

### Schema decisions

1. **Dismantle row-level `ClusterMeta`.** Keep it as backend construction input
   and once-per-payload metadata. Canonical rows carry `clusterId` only in
   `ref`; frontend cross-cluster displays obtain the label from the workspace
   registry and never retain a per-row `clusterName` copy.
2. **Require `ResourceRef.resource` on canonical rows.** Although the general
   resource model permits it as optional descriptor metadata, every row type in
   the inventory is produced from a known GVR, and row navigation, permissions,
   response-cache invalidation, catalog hydration, and the existing parity
   guard benefit from retaining that exact GVR identity. Phase 1 updates the
   durable shared-resource-model wording to distinguish canonical row refs from
   more general refs.
3. **Keep keys derived from refs.** UID remains part of the ref when the producer
   has it, while the durable row key remains cluster/GVK/namespace/name shaped so
   replacement objects keep table focus/persistence behavior.
4. **Use exhaustive structural comparison at the page boundary.** Phase 3 will
   compare every own enumerable row field recursively, with identity keyed from
   `ref`. This keeps the comparator schema-complete without duplicating every DTO
   in handwritten descriptors; focused nested-value tests and per-family
   allocation gates decide where whole-row reuse remains enabled.

### Demand and ordering classification

- Typed resource tables, Browse/Custom catalog tables, and Object Panel Pods
  hold **query demand** for their base live scope and own their current query
  page.
- Namespace/namespace-metrics contexts, Global namespace fan-out,
  cluster-overview, object-details/YAML/map/events/Helm content, node
  maintenance, diagnostics-triggered reads, and retained non-table consumers
  hold **snapshot demand** where they require payload data.
- A scope may have both demands. Source clocks, readiness, permissions, stream
  health, polling fallback, and one backend live source are shared; query pages
  and bounded snapshot payloads have separate ownership.
- The resources stream sends a subscribe request before its current `start()`
  promise resolves, but server trust is granted only by `ACK` or the initial
  `RESET`. Phase 2 therefore adds an acknowledged-subscription barrier for query
  demand rather than treating a client send as backend registration.
- A source-clock change during an in-flight query changes the query lifecycle
  identity, cancels application of the old response, and issues a replacement
  page request. Backend cache invalidation remains ordered before signal
  broadcast.

### Initial wire and encode baseline

Command:

```bash
go test ./backend/refresh/snapshot -run TestRepresentativeResourceRowWireSizes -v
go test ./backend/refresh/snapshot -run '^$' -bench BenchmarkRepresentativeResourceRowWireEncode -benchmem -count 5
```

Measured on Apple M2 Max / arm64 with 1,000 producer-built rows:

| Family | Uncompressed JSON bytes | Encode time range | Allocated bytes range | Allocations |
| --- | ---: | ---: | ---: | ---: |
| Config | 372,001 | 495-497 us | 378-382 KB | 2 |
| Events | 787,894 | 1.027-1.038 ms | 807-817 KB | 2 |
| Pods | 598,001 | 798-804 us | 602-611 KB | 2 |
| Workloads | 605,001 | 799-802 us | 612-623 KB | 2 |
| Nodes | 703,001 | 964-970 us | 713-717 KB | 2 |
| Custom resources | 642,001 | 1.090-1.102 ms | 735-755 KB | 4,002-4,003 |

The fixture generator also records the same payloads at 50 and 250 rows. Phase
1 reruns these exact commands for row-shape comparison; frontend apply/heap,
production HTTP bytes, first-page, quiet-refresh, and React measurements remain
separate gates.

### Implementation results

The same producer-built fixture command after the ref-only migration produced:

| Family | 50 rows | 250 rows | 1,000 rows | 1,000-row reduction |
| --- | ---: | ---: | ---: | ---: |
| Config | 12,201 B | 61,001 B | 244,001 B | 34.4% |
| Events | 32,792 B | 164,143 B | 656,894 B | 16.6% |
| Pods | 24,601 B | 123,001 B | 492,001 B | 17.7% |
| Workloads | 23,601 B | 118,001 B | 472,001 B | 22.0% |
| Nodes | 30,401 B | 152,001 B | 608,001 B | 13.5% |
| Custom resources | 23,101 B | 115,501 B | 462,001 B | 28.0% |

The frontend page-local comparison benchmark for 1,000 rows measured
0.596 ms mean / 0.711 ms p99 for exhaustive static-row comparison and
0.382 ms mean / 0.451 ms p99 for dynamic-family ref-only sharing:

```bash
npx vitest bench src/shared/utils/structuralShareResourceRows.bench.ts --run
```

Best-speed gzip was evaluated and removed from production. At 1,000 rows it
reduced Events from 656,894 B to 48,921 B, Pods from 492,001 B to 16,333 B,
and custom resources from 462,001 B to 16,396 B. The transport-encode
benchmark, however, increased representative encode time from roughly
0.73-0.96 ms to 1.53-2.18 ms and increased allocated bytes from roughly
0.5-0.7 MB to 1.8-2.5 MB. That failed the CPU/allocation gate, so no response
compression middleware or frontend decoder remains in production code.

The production identity-path line-count set was defined as the canonical Go
row DTOs, catalog row DTO, generated TypeScript contract, frontend base row
types, custom-row adapter, and the generated-contract row inventory. It changed
from 3,265 lines to 3,137 lines: a net reduction of 128 lines (3.9%) while
adding the enforcement inventory.

Rendered Wails validation covered populated Nodes, Browse, cluster Events,
cluster-scoped Custom rows, and all-namespace Autoscaling. Network inspection
showed Nodes and Browse requesting only their bounded query scopes; no query-only
base-snapshot request was present. Opening an HPA showed the typed Target,
Replicas, Metrics, Scale Up, and Scale Down sections.

Two measurement-only gates remain open: a packaged native-webview retained/peak
heap plus React-commit comparison, and packaged-webview negotiated HTTP byte
capture. They do not gate a production codec because no codec shipped, but they
are still required before claiming measured end-to-end memory or transport
improvement beyond the row-size and eliminated-request evidence above.

### Phase 5 — Remove superseded paths and close documentation

- [x] Remove temporary adapters, dual-shape fixtures, fallback accessors,
  superseded snapshot-demand plumbing, and benchmark-only production hooks.
- [ ] Re-run the production inventory and search for own-identity flat fields,
  table-owned snapshot leases, duplicate row caches, and alternate key builders.
- [x] Confirm the final production source line count for the affected path is
  below the Phase 0 baseline; investigate any growth before accepting it.
- [x] Move durable contracts from this plan into the architecture and agent
  guidance named above.
- [ ] Delete this temporary plan only after all durable guidance has moved and
  every checklist item is resolved.

## Release gates

### Correctness and stability

- Every canonical Kubernetes object-row ref contains `clusterId`, `group`,
  `version`, `kind`, and object `name`; namespace remains absent/empty only for
  cluster-scoped objects.
- Every canonical Kubernetes object-row type recorded by the Phase 0 inventory
  is present in the Go reflection test. Non-resource/operational exclusions are
  named and justified in that inventory.
- Canonical Kubernetes object rows do not embed `ClusterMeta`; cluster metadata
  appears once in their payload envelope, `clusterId` remains in each row ref,
  and display names derive from the workspace cluster registry.
- `ResourceRef.resource` requiredness matches the Phase 0 decision across Go row
  validation, parity tests, generated wire types, and frontend hydration.
- Row keys remain unique across clusters, API groups, versions, kinds,
  namespaces, and names. UID handling remains consistent with the canonical key
  contract selected in Phase 0.
- HPA typed details/actions and Event involved-object navigation remain covered
  by cross-layer tests.
- Query results remain equivalent for filtering, search, sort, facets,
  pagination, anchors, totals, export, actions, and navigation.
- Subscribe/query ordering, stale-response rejection, reconnect, reset, replay,
  permission denial, partial permission, polling fallback, pause/resume,
  multi-cluster isolation, and teardown pass focused tests.
- Backend tests prove cache invalidation occurs before signal delivery for every
  signal-backed query path.
- Query-only, snapshot-only, and simultaneous query-plus-snapshot demand each
  pass lifecycle tests.
- No new unbounded map, cache, string pool, ref pool, timer, subscription, or
  goroutine is introduced.

### Payload and memory

- Uncompressed serialized bytes decrease for every migrated representative
  fixture; report absolute bytes and percentage by row family and row count.
- Production-transport bytes decrease for query-only table activation and quiet
  refresh. Count eliminated bounded snapshot responses separately from row-shape
  savings.
- Steady-state retained frontend heap decreases for a representative
  multi-cluster session with foreground and background scopes.
- Peak frontend heap during parse/apply does not regress outside the measured
  run-to-run variance established in Phase 0.
- Query-only scopes retain the current query page and liveness metadata, not a
  second bounded row snapshot.

### Performance

- Compare p50 and p95 backend query/encode, transport, frontend parse/apply,
  first-page, quiet-refresh, and React commit timings on the same fixture,
  hardware, build mode, and run protocol.
- No measured latency or CPU metric may regress beyond the Phase 0 variance
  band without explicit review and a demonstrated larger end-to-end benefit.
- Initial activation and reconnect must not add requests or widen the
  stale-data window.
- Unchanged-page structural sharing is gated per family: static families are the
  expected whole-row win, while metric-bearing and event-churn results are
  reported separately. Remove a family's whole-row comparator if its measured
  overhead does not reduce that family's allocations and React work.
- Compression or a key cache remains optional and must be removed if its own
  overhead fails these gates.

### Source reduction

- Production source lines in row identity DTOs, constructors, normalizers,
  accessors, compatibility adapters, and key builders must decrease from the
  Phase 0 baseline.
- Tests and durable documentation are excluded from that line-count target.
- Do not accept a net production-line increase that merely moves duplicate
  identity handling behind a new abstraction.

## Validation commands and passes

Run focused tests after each red/green/refactor slice, then run the following on
the final implementation:

```bash
go test ./backend/resourcemodel/... ./backend/kind/... ./backend/refresh/...
npm --prefix frontend test
npm --prefix frontend run build
mage qc:prerelease
```

Also perform:

- wire-shape conformance tests using Go-marshaled fixtures parsed by frontend
  normalizers;
- Go benchmarks with `benchstat` or an equivalent recorded comparison;
- production-build frontend performance and heap captures using the committed
  fixtures;
- rendered Wails UI passes for representative cluster, namespace, Browse,
  Events, Autoscaling, custom-resource, empty, loading, denied, partial, and
  populated states;
- multi-cluster switching with foreground/background scopes and simultaneous
  query/snapshot consumers; and
- `git diff --check` plus a final inspection for unintended generated or
  unrelated changes.

## Open questions to resolve in Phase 0

1. What acknowledgement marks the Wails stream subscription as active, and can
   it provide the subscribe-before-query barrier without a new backend API?
2. Which non-table consumers require bounded snapshots for each query-backed
   domain, and which require only clocks/readiness/permission?
3. Does the Phase 0 consumer inventory reveal any blocker to the selected
   `ClusterMeta` endpoint (payload envelope retained, row embedding removed,
   display name derived from the workspace registry)? Any blocker must revise
   the central schema decision before Phase 1 rather than create an exception.
4. Is `ResourceRef.resource` required for every canonical Kubernetes object row,
   or does it remain conditional descriptor/RBAC metadata? The answer must
   reconcile the durable documentation
   (`docs/architecture/shared-resource-model.md:53-54`), parity helper
   (`backend/refresh/snapshot/parity_test.go:199-218`), and custom-row frontend adapter
   (`frontend/src/modules/browse/hooks/customCatalogRowAdapter.ts:29-47`).
5. Should exhaustive row equality be generated from DTO schemas or declared in
   per-family descriptors? The choice must detect nested mutations and reduce
   production code rather than duplicate every row type manually.
6. Which standard HTTP content encoding and threshold pass the packaged-webview
   payload, latency, CPU, allocation, cancellation, ETag, and error gates?
7. What measured target defines sufficient wire reduction after field removal
   and query-demand splitting, before a dictionary protocol is considered?

## Progress notes

- **2026-07-21:** Created the combined cross-layer plan after tracing canonical
  identity, resource-grid queries, refresh liveness, snapshot retention, stream
  signals, and current polling-only structural sharing. Implementation has not
  started.
- **2026-07-21:** Validated external review comments and revised the plan to
  name row-level `ClusterMeta` removal, reconcile the current `resource`
  enforcement points, preserve invalidate-before-broadcast ordering, set
  per-family structural-sharing expectations, correct the prefix-interning
  rationale, identify loopback HTTP as the production query transport, and
  require Go-side row-schema enforcement. Implementation has not started.
- **2026-07-21:** Defined the reflection/release-gate type set as canonical
  Kubernetes object rows, added an explicit Namespace migration, clarified that
  the catalog slice covers `objectcatalog.Summary` in Browse and `catalog-diff`,
  and excluded the operational `nodemaintenance.DrainJob` row with a recorded
  reason. Implementation has not started.
- **2026-07-21:** Locked the exact Go canonical-row type set, added the previously
  unnamed Attention and Object Panel Event rows, classified exclusions and
  query/snapshot demand, approved row-level `ClusterMeta` removal, and required
  `ResourceRef.resource` for canonical table rows.
- **2026-07-21:** Migrated the canonical row inventory to ref-only identity,
  added Go schema enforcement, split query/snapshot demand, added
  subscribe-before-query acknowledgement and scheduler fallback identities,
  added page-local structural sharing, and moved the resulting contracts into
  the architecture docs. Producer fixtures show 13.5%-34.4% smaller JSON and
  the selected identity-path sources are 128 lines smaller. Gzip was evaluated
  and removed after failing CPU/allocation gates. Packaged-webview heap and
  negotiated-transport captures remain open measurement work.
- **2026-07-21:** Final validation passed `mage qc:prerelease`, including Go
  formatting/vet/static analysis/race tests, frontend lint/typecheck, 3,774
  frontend tests, unused-code analysis, and a zero-finding dependency/secret
  scan. The representative 50/250/1,000-row wire fixture also passed again on
  the formatter-stable worktree.
