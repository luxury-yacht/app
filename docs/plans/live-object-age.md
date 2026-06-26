# Live Object Age Plan

Status: Draft, ready for implementation.

## Problem

Object age is a relative display value, but several paths currently treat it as
stored row text. Backend table summaries can carry both `age` and
`ageTimestamp`, for example `ConfigSummary` and `RBACSummary` in
`backend/kind/streamrows/streamrows.go:132-144`; `NewRBACSummary` fills `Age`
from `FormatAge(...)` and `AgeTimestamp` from `CreationMillis(...)` in
`backend/kind/streamrows/streamrows.go:150-158`. `FormatAge` uses
`time.Since(t)` in `backend/internal/timeutil/age.go:14`, so an `age` string is
only current at construction time.

The shared frontend age column renders `item.age` and uses `ageTimestamp` only
for sorting in `frontend/src/shared/components/tables/columnFactories.tsx:26-38`.
That makes age updates depend on row replacement instead of wall-clock time.

## Contract

Backend producers should send absolute timestamps. Frontend renderers should
format relative age text from those timestamps.

- Use `ageTimestamp` for resource table rows when the row already has it.
- Use `creationTimestamp` for catalog, object panel header, and object-map nodes.
- Keep backend `age` only as a compatibility fallback until every affected DTO
  has an absolute timestamp.
- Do not refetch snapshots only to advance relative text. The frontend already
  has a rendering utility that computes age from the current clock in
  `frontend/src/utils/ageFormatter.ts:6-24`.

## Surface Inventory

### Shared Resource Tables

Primary path: `createAgeColumn` in
`frontend/src/shared/components/tables/columnFactories.tsx:26-38`.

Representative consumers:

- Namespace pods: `frontend/src/modules/namespace/components/NsViewPods.tsx:409`.
- Cluster and namespace config/RBAC/storage/custom/CRD/quotas/autoscaling/helm
  views from the `createAgeColumn(...)` call sites found in
  `frontend/src/modules/cluster` and `frontend/src/modules/namespace`.
- Workloads: `frontend/src/modules/namespace/components/useWorkloadTableColumns.tsx:184-187`.
- Cluster nodes use a custom age sort override in
  `frontend/src/modules/cluster/components/ClusterViewNodes.tsx:297-305`.

Implementation target: make the shared column render from `ageTimestamp` when
available, while preserving existing sort keys and fallback behavior.

### Browse and Catalog-Backed Custom Rows

Catalog rows expose raw creation time as `creationTimestamp` in
`backend/objectcatalog/types.go:60-72`, populated from Kubernetes object metadata
in `backend/objectcatalog/collect.go:358-374`.

Current frontend paths convert that timestamp into a row `age` string during
adaptation:

- Browse rows: `frontend/src/modules/browse/hooks/useBrowseColumns.tsx:47-65`.
- Catalog-backed custom fallback rows:
  `frontend/src/modules/browse/hooks/customCatalogRowAdapter.ts:115-136`.

Implementation target: preserve `ageTimestamp`, render relative text at display
time, and keep catalog identity untouched.

### Object Panel Header

The object-details snapshot exposes `creationTimestamp` for every object panel
detail payload in `backend/refresh/snapshot/object_details.go:61-69` and assigns
it in `backend/refresh/snapshot/object_details.go:164-168`.

`ResourceHeader` currently formats that timestamp once per render in
`frontend/src/shared/components/kubernetes/ResourceHeader.tsx:28-56`.

Implementation target: replace one-off `formatAge(...)` use with the shared live
age renderer.

### Object Panel Embedded Tables

Object-panel Pods use `PodSnapshotEntry`, which includes `ageTimestamp` in
`frontend/src/core/refresh/types.ts:667-678`, but the Pods tab currently passes a
getter that returns `pod.age` in
`frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx:237-241`.

Object-panel Jobs use the Wails DTO `JobSimpleInfo`, which currently exposes
`Age` but no timestamp in `backend/resources/types/types.go:716-730`; the
generated frontend model mirrors that shape in `frontend/wailsjs/go/models.ts:4996-5012`.

Implementation target:

- Let Pods use `ageTimestamp` through the shared age column.
- Add an absolute timestamp to `JobSimpleInfo`, populate it from the Job
  creation timestamp, regenerate frontend bindings, and render Jobs age from
  that timestamp.

### Events

Event table rows already carry `AgeTimestamp` in
`backend/refresh/snapshot/namespace_events.go:117-122`, populated in
`backend/refresh/snapshot/namespace_events.go:63-68`.

Frontend event tables already format from timestamps:

- Cluster events: `frontend/src/modules/cluster/components/ClusterViewEvents.tsx:141-143`.
- Namespace events: `frontend/src/modules/namespace/components/NsViewEvents.tsx:177-179`.
- Object-panel events:
  `frontend/src/modules/object-panel/components/ObjectPanel/Events/EventsTab.tsx:420-429`.

Implementation target: connect these timestamp-based renderers to the same
clock so they repaint even when event rows are unchanged.

### Object Map

Object-map nodes carry `CreationTimestamp` in
`backend/kind/objectmapnode/node.go:29-30`, formatted as RFC3339 in
`backend/kind/objectmapnode/node.go:80-88`.

Frontend card text is derived in
`frontend/src/modules/object-map/objectMapG6Data.ts:101-105` and assigned to
`cardAgeText` in `frontend/src/modules/object-map/objectMapG6Data.ts:253-315`.
The G6 renderer memoizes data conversion in
`frontend/src/modules/object-map/ObjectMapG6Renderer.tsx:354-389`, and the apply
queue compares `cardAgeText` in
`frontend/src/modules/object-map/objectMapG6ApplyQueue.ts:100-114`.

Implementation target: feed the shared age clock into the G6 data conversion so
age text changes update card style without recomputing backend graph data or
changing layout.

### Namespace Summary Context

`NamespaceContext` maps namespace creation time into `age` text in
`frontend/src/modules/namespace/contexts/NamespaceContext.tsx:191-207`.

Implementation target: keep the absolute timestamp in the mapped model or render
age through the shared live age renderer at the consuming surface.

## Implementation Slices

1. Shared clock and renderer.
   - Add a small shared age clock hook or external store.
   - Use a minute-oriented tick for ages older than one minute, with faster
     ticks only while any rendered value is in the seconds range.
   - Expose a component/helper that accepts `timestamp`, optional `fallback`,
     and optional full-date title formatting.

2. Shared table column.
   - Update `createAgeColumn` to render from `ageTimestamp` when present.
   - Preserve existing `sortValue` behavior for numeric timestamps.
   - Preserve fallback `age` text for rows that have no timestamp.

3. Browse and catalog-backed custom rows.
   - Stop baking displayed age into row data when `creationTimestamp` is
     available.
   - Keep `ageTimestamp` as the display/sort source.

4. Object panel header and embedded tables.
   - Switch `ResourceHeader` to the shared renderer.
   - Let Pods use the shared timestamp path.
   - Add a timestamp field to `JobSimpleInfo`, populate it in Job summary
     builders, regenerate Wails models, and render Jobs age from the timestamp.

5. Events.
   - Route event table age renderers through the shared live renderer.
   - Keep existing event sort values based on `ageTimestamp`.

6. Object map.
   - Pass the age clock value into `ObjectMapG6Renderer` data conversion.
   - Keep layout/model inputs stable so only card age text changes.
   - Verify `cardAgeText` updates flow through the existing apply queue.

7. Namespace summary context.
   - Replace preformatted namespace `age` where possible with an absolute
     timestamp plus live rendering at the display edge.

## Tests

Use red/green/refactor for each behavior slice.

- Shared age renderer: fake timers prove text advances from seconds to minutes
  and from minutes to hours without new row data.
- `createAgeColumn`: fake timers prove a row with stable `ageTimestamp` renders
  updated text, and sort behavior remains timestamp-based.
- Browse/custom catalog: fake timers prove catalog rows repaint age without
  replacing catalog data.
- Object panel header: fake timers prove `creationTimestamp` age advances while
  the detail payload is unchanged.
- Object-panel Pods/Jobs: prove embedded table ages advance; add backend DTO test
  coverage for any new Job timestamp field.
- Events: prove timestamp-backed event ages advance while preserving newest-first
  sort behavior.
- Object map: prove `cardAgeText` changes when the age clock advances and layout
  node positions remain unchanged.

Focused validation before broader checks:

```sh
npm run test --prefix frontend -- columnFactories browse object-panel object-map
npm run typecheck --prefix frontend
go test ./backend/resources/... ./backend/refresh/snapshot
```

Run `mage qc:prerelease` only after the performance/fix loop is ready for the
long gate again.

## Completion Criteria

- Visible object ages advance without snapshot refetch or resource stream row
  replacement.
- Tables, Browse, object panel details, object panel embedded tables, events,
  namespace summary surfaces, and object-map cards use the same frontend age
  formatting contract.
- Backend DTOs that feed age-bearing frontend surfaces carry an absolute
  timestamp or have a documented fallback.
- Sorting continues to use stable absolute timestamp values rather than relative
  display text.
