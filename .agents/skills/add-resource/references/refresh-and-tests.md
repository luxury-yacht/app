# Catalog, Refresh, Streams, Map, and Validation

Read this reference when a resource participates in discovery, Browse, a list
or table, live stream rows, diagnostics, or the object map.

## Catalog and list ownership

The object catalog owns discovery, existence, GVK/GVR, scope, Browse namespace
metadata, and cluster listings. Namespace LIST rows come only from the
`namespaces` refresh domain. Rich typed rows live in
`backend/refresh/snapshot`; do not place list payloads in resource services.

## Refresh table/list contract

Update the producer and every consumer together:

- snapshot builder and `backend/refresh/system/registrations.go`;
- permission declaration plus snapshot/runtime gates;
- backend-owned DTO registration in
  `backend/internal/genrefreshcontracts/registry.go`, followed by
  `mise exec -- go generate ./backend`;
- shared refresh-domain metadata and frontend registrations/config;
- diagnostics and manual-refresh mapping; and
- the `ResourceInventoryTable`/GridTable consumer and shared columns.

Typed table rows come from the kind's `Stream` descriptor facet. Snapshot
builders collect registered descriptor rows through the shared stream
collectors. Preserve the normalized query envelope and catalog-shaped identity.

## Resource streams

Declare `Stream *streamspec.Descriptor` on the kind descriptor with its row DTO
in `backend/kind/streamrows`. Generic registration happens through
`registerDescriptorStreams` in
`backend/refresh/resourcestream/stream_descriptor_dispatch.go`.

Use a bespoke direct/network handler only for related-object invalidation or a
non-shared informer factory. Snapshot and stream projections must share row
helpers and parity tests. Add the frontend stream descriptor only when live row
updates are required.

Every refresh and stream request targets one cluster. Aggregate displays fan
out into separate single-cluster scopes rather than sending a multi-cluster
scope through the transport.

For substantial table behavior, use the browse-tables skill. For lifecycle,
doorbell, or stream-health changes, use the refresh-subsystem skill.

## Object map and optional catalog priority

Use the object-map skill when the kind adds graph nodes or edges. Backend graph
data, frontend support checks, and navigation refs change together; do not add
only a renderer allowlist entry.

Change `streamingResourcePriority` in `backend/objectcatalog/service.go` only
when evidence shows the kind needs earlier catalog availability.

## Surface validation matrix

- Kind/model: identity, status, facts, links, and relationship tests.
- Details: happy path, relevant error path, generated bindings, frontend DTO
  typecheck, Overview render, and drift check.
- Refresh/table: snapshot tests, permission denied behavior, contract
  generation, table specs, and diagnostics.
- Stream: registration, single-cluster scope, update/delete behavior, and
  snapshot parity.
- Object map: backend graph cases plus frontend model/render/navigation specs.

Use the focused commands in the main skill and the root final gate. Inspect the
worktree after generation and formatter-driven checks.
