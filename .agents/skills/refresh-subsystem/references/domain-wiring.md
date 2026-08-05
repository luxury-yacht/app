# Refresh Domain Wiring

Read this reference when adding or changing a refresh domain, scope, generated
payload, permission gate, or streamed table registration.

## Backend registration

Add the domain to `domainRegistrations()` in
`backend/refresh/system/registrations.go`; dependencies determine order.
Registration styles are:

- `direct`: no permission gate;
- `list`: list permission or skip; and
- `listWatch`: list plus watch, optional list-only fallback, and an explicit
  permission-denied domain when denied.

Declare permissions on the registration config. Permission preflight runs
before the runtime `permissionGate`. Informers register in
`backend/refresh/informer/factory.go`.

`backend/refresh/domain/refresh-domain-contract.json` owns shared category,
refresher, timing, orchestrator, diagnostics, source-clock, stream, and payload
metadata. Register backend-owned DTOs/enums in
`backend/internal/genrefreshcontracts/registry.go`, run
`mise exec -- go generate ./backend`, and never hand-edit generated frontend
types.

Frontend reducer-only state stays in `frontend/src/core/refresh/types.ts`.
Refresher names, domain registrations, manual mapping, diagnostics, and stream
descriptors must remain synchronized through the shared contract tests.

## Streamed tables

Registry-driven kinds declare a `Stream` descriptor in their per-kind
descriptor. `stream_descriptor_dispatch.go` handles generic registration;
helpers own permissions/event mapping, while direct/network/related registration
files contain only bespoke informer or relationship behavior.

Projection descriptors define row projection, source clocks, and permissions.
Do not assign ad-hoc rows inside stream handlers. Add snapshot/stream parity for
each domain or an explicit justified exclusion; every new summary field needs a
population assertion.

Typed table payloads embed the normalized query envelope. Consumer tables use
one controller/source contract and receive complete object identity.

## Snapshot and frontend scheduling

`backend/refresh/snapshot/service.go` singleflights by cache key. Truncated or
partial-batch snapshots are not cached; only final batches are. Signal producers
invalidate the domain cache before delivery.

`RefreshManager.ts` owns idle/refresh/cooldown scheduling and backoff.
`orchestrator.ts` owns per-cluster runtimes, scopes, in-flight deduplication,
stream-health gates, and metrics demand. Context changes abort then reconcile;
global pause blocks passive work but not foreground/manual work.

Any consumer of stream-domain `state.data` needs
`useStreamSignalRefetch(domain, scopes)` or a query-table `liveDataVersion`.
`streamConsumerDrift.test.ts` enforces the rule. Contexts do not copy domain
rows; query-backed tables own their data and base-scope lease.
