# Catalog, Refresh, Streams, Map, and Validation

For a resource that participates in discovery, Browse, a list or table, live
stream rows, diagnostics, or the object map. Catalog rules live in
[catalog](../../../../docs/architecture/catalog.md); single-cluster scope fan-out
in [multi-cluster](../../../../docs/architecture/multi-cluster.md).

## Refresh table/list

Typed table rows come from the kind's `Stream` descriptor facet; snapshot
builders collect registered descriptor rows through the shared stream
collectors. Preserve the normalized query envelope and catalog-shaped identity.
Update the producer and every consumer together:

- snapshot builder and `backend/refresh/system/registrations.go`;
- permission declaration plus snapshot/runtime gates;
- backend-owned DTO registration in
  `backend/internal/genrefreshcontracts/registry.go`, then
  `mise exec -- go generate ./backend`;
- shared refresh-domain metadata and frontend registrations/config;
- diagnostics and manual-refresh mapping;
- the `ResourceInventoryTable`/GridTable consumer and shared columns.

Use the browse-tables skill for substantial table behavior and the
refresh-subsystem skill for lifecycle, doorbell, or stream-health changes.

## Resource streams

- Declare `Stream *streamspec.Descriptor` on the kind descriptor with its row DTO
  in `backend/kind/streamrows`; `registerDescriptorStreams` in
  `backend/refresh/resourcestream/stream_descriptor_dispatch.go` registers it.
- Use a bespoke direct/network handler only for related-object invalidation or
  a non-shared informer factory.
- Snapshot and stream projections share row helpers and parity tests.
- Streams carry only change signals; the query-backed view refetches its page
  and no live row crosses the wire
  ([delivery](../../../../docs/architecture/data-layer.md#delivery--page--refetch-on-signal)).
  Frontend stream domains derive from the generated refresh contract
  (`resourceStreamDomains.ts`); never hand-add one.

## Object map and catalog priority

- Use the object-map skill when the kind adds graph nodes or edges. Backend graph
  data, frontend support checks, and navigation refs change together; never add
  only a renderer allowlist entry.
- Change `streamingResourcePriority` in `backend/objectcatalog/service.go` only
  when evidence shows the kind needs earlier catalog availability.

## Surface validation matrix

- Kind/model: identity, status, facts, links, and relationship tests.
- Details: happy path, relevant error path, generated bindings, frontend DTO
  typecheck, Overview render, and drift check.
- Refresh/table: snapshot tests, permission-denied behavior, contract
  generation, table specs, and diagnostics.
- Stream: registration, single-cluster scope, update/delete behavior, and
  snapshot parity.
- Object map: backend graph cases plus frontend model/render/navigation specs.
