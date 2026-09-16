# Refresh Domain Wiring

Read this reference when adding or changing a refresh domain, scope, generated
payload, permission gate, or streamed table registration.

## Backend registration

Construction and lifecycle entry points:

| Concern | Code landmarks |
| --- | --- |
| Per-cluster construction and readiness | `backend/refresh_setup.go`, `backend/refresh/system/manager.go` |
| Selection changes and subsystem swaps | `backend/refresh_update.go`, `backend/refresh_subsystems.go` |
| Teardown and auth recovery | `backend/refresh_recovery.go` |

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
`mise exec -- go generate ./backend`, and never hand-edit generated outputs.
Set each domain's `refreshPayloadType` in the shared contract. The generator is
the only writer of `frontend/src/core/refresh/types.generated.ts` and
`backend/refresh/domain/policy_generated.go`; do not format the frontend output
with Biome. Keep only frontend-owned reducer state in `types.ts`.

Snapshot builders live in `backend/refresh/snapshot`. Align the registration's
permission gate with `backend/refresh/system/permission_gate.go`; denied domains
use `RegisterPermissionDeniedDomain` and surface `PermissionIssue` entries.
Manual refresh enters at `/api/v2/refresh/{domain}` through
`backend/refresh/api/server.go` and `ManualQueue` in `backend/refresh/types.go`.

Per-cluster streams are wired in `backend/refresh/system/streams.go`;
`RefreshCoordinator` builds aggregate routing in `backend/refresh_setup.go`,
and `internal/bootstrap` registers streams before the sole Wails service.
Atomic handler publication lives in `backend/refresh_transport.go`.

Cross-layer landmarks:

| Concern | Code landmarks |
| --- | --- |
| Frontend reducer and refresher mapping | `frontend/src/core/refresh/types.ts`, `frontend/src/core/refresh/refresherTypes.ts` |
| Domain and stream orchestration | `frontend/src/core/refresh/domainRegistrations.ts`, `frontend/src/core/refresh/streaming/resourceStreamDomains.ts`, `frontend/src/core/refresh/streaming/resourceStreamManager.ts` |
| Canonical stream projection | `backend/refresh/resourcestream/projection_descriptors.go` |
| Snapshot/stream parity | `backend/refresh/snapshot/parity_test.go` |

These mappings, manual refresh behavior, diagnostics, and stream descriptors
must remain synchronized through the shared contract tests.

Frontend refresher names and manual targets live in `refresherTypes.ts`, timing
in `refresherConfig.ts`, registration in `orchestrator.ts`, and diagnostics
configuration in `components/diagnostics/diagnosticsPanelConfig.ts` (all under
`frontend/src/core/refresh`). `RefreshManager.ts` selects manual targets;
Wails `JSONStream` managers live under `streaming`.

Validate changed domain state in the Diagnostics panel. Backend telemetry comes
from `backend/refresh/telemetry/recorder.go`; catalog lifecycle and diagnostics
are owned by `RefreshCoordinator` in `backend/refresh_object_catalog.go`.
Browse keeps its catalog snapshot/manual-refresh flow; do not add stream-driven
renders for Browse.

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
