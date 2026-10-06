# Refresh Domain Wiring

Read when adding or changing a refresh domain, scope, generated payload,
permission gate, or streamed table registration. Contract rules live in
`docs/architecture/refresh-system.md`; this file lists the wiring steps.

## Backend

| Concern | Code landmarks |
| --- | --- |
| Per-cluster construction and readiness | `backend/refresh_setup.go`, `backend/refresh/system/manager.go` |
| Selection changes and subsystem swaps | `backend/refresh_update.go`, `backend/refresh_subsystems.go` |
| Teardown and auth recovery | `backend/refresh_recovery.go` |
| Domain registration | `domainRegistrations()` in `backend/refresh/system/registrations.go` (dependencies set order) |
| Informers | `backend/refresh/informer/factory.go` |
| Snapshot builders | `backend/refresh/snapshot` |
| Per-cluster streams; aggregate routing | `backend/refresh/system/streams.go`; `backend/refresh_setup.go` |
| Handler publication | `backend/refresh_transport.go`; `internal/bootstrap` registers streams before the sole Wails service |
| Manual refresh | `/api/v2/refresh/{domain}` in `backend/refresh/api/server.go`, `ManualQueue` in `backend/refresh/types.go` |
| Telemetry; catalog lifecycle | `backend/refresh/telemetry/recorder.go`; `backend/refresh_object_catalog.go` |

1. Add the authored entry (category, refresher, timing, orchestrator,
   diagnostics, source clocks, stream, `refreshPayloadType`) to
   `backend/refresh/domain/refresh-domain-contract.json`.
2. Register backend-owned DTOs/enums in
   `backend/internal/genrefreshcontracts/registry.go`, run
   `mise exec -- go generate ./backend`, and never Biome-format
   `types.generated.ts`. Keep only frontend-owned reducer state in
   `frontend/src/core/refresh/types.ts`.
3. Pick a registration style and declare permissions on its config:
   `direct` (no gate); `list` (list permission or skip); `listWatch` (list plus
   watch, optional list-only fallback, explicit permission-denied domain when
   denied). Preflight runs before the runtime `permissionGate`.
4. Align the gate with `backend/refresh/system/permission_gate.go`; denied
   domains use `RegisterPermissionDeniedDomain` and surface `PermissionIssue`.
5. Change frontend mappings, manual refresh behavior, diagnostics, and stream
   descriptors in the same change; the shared contract and parity tests keep
   them synchronized.

## Streamed tables

- Registry-driven kinds declare a `Stream` descriptor in their per-kind
  descriptor; `backend/refresh/resourcestream/stream_descriptor_dispatch.go`
  registers them generically. Helpers own permissions and event mapping;
  direct/network/related registration files hold only bespoke informer or
  relationship behavior.
- Projection descriptors (`backend/refresh/resourcestream/projection_descriptors.go`)
  define row projection, source clocks, and permissions; never assign ad-hoc
  rows inside stream handlers.
- Add snapshot/stream parity (`backend/refresh/snapshot/parity_test.go`) for
  each domain or an explicit justified exclusion; every new summary field
  needs a population assertion.
- Typed table payloads embed the normalized query envelope; consumer tables
  use one controller/source contract with complete object identity.

## Frontend

| Concern | Code landmarks (under `frontend/src/core/refresh`) |
| --- | --- |
| Refresher names and manual targets | `refresherTypes.ts` (selected by `RefreshManager.ts`) |
| Timing | `refresherConfig.ts` |
| Domain registration and orchestration | `domainRegistrations.ts`, `orchestrator.ts` |
| Streams (keep each concern in its module) | `streaming/resourceStreamDomains.ts`; connection lifecycle `resourceStreamConnection.ts`; subscription state `resourceStreamSubscriptions.ts`; wire reducer `resourceStreamProtocol.ts`; resync and effects `resourceStreamManager.ts` |
| Diagnostics config | `components/diagnostics/diagnosticsPanelConfig.ts` |

- Any consumer of stream-domain `state.data` needs
  `useStreamSignalRefetch(domain, scopes)` or a query-table `liveDataVersion`;
  `streamConsumerDrift.test.ts` enforces it. Contexts do not copy domain rows;
  query-backed tables own their data and base-scope lease.
- Browse keeps its catalog snapshot/manual-refresh flow; do not add
  stream-driven renders for Browse.
- Validate the changed domain's state in the Diagnostics panel.
