# Refresh Streaming Simplification Plan

## Overview

The refresh system is one of the app's core stability surfaces. It keeps
cluster data current across snapshots, resource streams, event streams,
diagnostics, telemetry, manual refreshes, and per-cluster background refresh.

The current implementation is functional but expensive to extend. The frontend
resource stream manager combines domain registration rules, scope
normalization, connection lifecycle, subscriptions, row merging, sorting,
drift detection, resync behavior, telemetry, and refresh-store writes in one
large module. The backend resource stream manager has a similar concentration
of responsibilities: informer wiring, custom resource informers, subscription
state, buffering, and every per-kind update projection live together.

This plan reduces that complexity and corrects the resource-stream scope model.
Resource streams should be single-cluster by construction. Multiple open
cluster tabs can still refresh in the background, but that should happen by
explicit per-cluster fan-out rather than by passing multi-cluster scopes into a
single resource stream domain.

## Architecture Decision

The app can have multiple cluster tabs open, but only one cluster tab is the
active foreground cluster. Background clusters should continue refreshing, but
each cluster's refresh work should run under a cluster-specific runtime/scope.

The target shape is:

- Keep one global refresh coordinator for app-wide concerns: active cluster,
  connected/background clusters, settings, visibility, kubeconfig lifecycle,
  auth pause/recovery, and diagnostics aggregation.
- Introduce or make explicit per-cluster refresh runtimes beneath that
  coordinator. Each runtime owns enabled domains, in-flight work, stream
  subscriptions, stream health, telemetry, and scoped store writes for exactly
  one `clusterId`.
- Treat resource stream subscriptions as single-cluster only. If multiple
  clusters need the same domain refreshed, the coordinator/background refresher
  should fan out to each cluster runtime.
- Keep true aggregate domains explicit. For example, the `namespaces` domain
  may aggregate open clusters for namespace selection, but resource WebSocket
  domains should not inherit that aggregate scope model.

## Goals

- Make resource stream behavior table-driven where the behavior is already
  repetitive.
- Keep snapshot and streaming row identity aligned for every streamed domain.
- Make it easier to add a resource kind without touching unrelated stream
  lifecycle code.
- Remove multi-cluster resource stream scopes in favor of explicit per-cluster
  refresh fan-out.
- Preserve background refresh for open clusters.
- Preserve drift detection, fallback, resync, and diagnostics behavior.
- Add tests that fail when snapshot and stream behavior drift apart.

## Non-Goals

- Do not replace the refresh system or streaming transports.
- Do not change domain names, payload shapes, or store keys.
- Do not change polling, SSE, WebSocket, or manual refresh semantics.
- Do not combine list/table snapshot builders into `backend/resources`.
- Do not remove diagnostics or telemetry while simplifying.
- Do not create fully independent top-level orchestrators per cluster tab.
  Global lifecycle concerns should remain coordinated in one place.
- Do not remove aggregate behavior from domains that intentionally own it, such
  as namespace listing.

## Current Hotspots

- `frontend/src/core/refresh/streaming/resourceStreamManager.ts`
  - Supported domain lists and domain categories
  - Scope normalization
  - Multi-cluster resource stream admission and merge handling
  - Row sorting
  - Row key building
  - Drift key-set construction
  - Per-domain row merging
  - Connection and subscription lifecycle
  - Resync and fallback handling
  - Refresh-store writes
- `backend/refresh/resourcestream/manager.go`
  - Informer handler registration
  - Custom resource informer lifecycle
  - Subscription and backpressure state
  - Per-kind update projection
  - Derived broadcasts, such as pod-to-workload and endpoint-slice-to-service
    updates

## Design Direction

Use descriptors for repetitive domain behavior, but keep cluster ownership out
of the descriptor. A descriptor should answer "how does this domain identify,
sort, merge, and drift-check rows?" It should not answer "can this domain be
multiplexed across multiple clusters?"

Introduce explicit stream domain descriptors on both sides.

Frontend descriptors should declare:

- Domain name
- Scope kind: namespace, pod, cluster
- Store payload collection accessor
- Row identity function
- Row sort function
- Row merge behavior
- Whether metrics should be preserved during row stream updates
- Drift key-set builder, ideally derived from the same row identity function

Backend descriptors should declare:

- Domain name
- Kubernetes group/resource/kind
- Scope builder
- Summary row builder
- Update metadata builder
- Optional secondary broadcasts for derived rows
- Permission requirements or the permission key used by existing registration

The descriptor layer should not hide hard cases. Pods, endpoint slices, Helm
release signals, and custom resources can keep explicit handlers where needed.
The goal is to remove repetitive mechanics, not to force every kind through a
bad generic abstraction.

The frontend coordinator/runtime boundary should declare:

- Active foreground `clusterId`
- Background/open `clusterId` set
- Domain scope category: single-cluster resource, explicit aggregate, or
  non-resource stream
- Per-cluster runtime lookup and lifecycle
- Per-cluster domain enablement and disablement
- Per-cluster stream health and telemetry aggregation
- Explicit fan-out for background refresh work

Resource stream scopes should contain exactly one cluster. A multi-cluster scope
reaching `ResourceStreamManager` should be treated as a bug or rejected at the
boundary.

## Implementation Sequence

The simplification should proceed in dependency order:

1. Separate resource-stream scope normalization from aggregate scope
   normalization.
2. Introduce the frontend per-cluster runtime boundary.
3. Extract and simplify resource snapshot application and row merge behavior.
4. Simplify metrics-only refresh once it can run inside the per-cluster model.
5. Extract connection/subscription lifecycle after the ownership boundaries are
   stable.
6. Apply backend descriptor/helper work after frontend behavior is covered.

The metrics-only phase should stay after the per-cluster runtime phase because
metrics freshness and stream fallback are user-visible and currently depend on
global orchestrator state.

## Phase 1: Frontend Domain Descriptors

- [x] Add a resource stream domain descriptor module.
- [x] Move supported-domain checks into descriptors.
- [x] Move cluster-scoped domain rules into descriptors.
- [x] Move `normalizeResourceScope` to use descriptor scope kind.
- [x] Move row sort functions into descriptor entries.
- [x] Move row key functions into descriptor entries.
- [x] Derive drift key-set builders from descriptor row keys where possible.
- [x] Keep the existing `ResourceStreamManager` public API unchanged.
- [x] Add unit tests for descriptor completeness across every streamed domain.

Progress:

- 2026-05-16: Added `resourceStreamDomains.ts` as the frontend descriptor table
  for all resource WebSocket domains. The stream manager now imports descriptor
  rules for domain support, cluster scope handling, scope normalization,
  metrics preservation, row sorting, row identity, and snapshot drift key
  construction. Added descriptor completeness tests covering every streamed
  domain.
- 2026-05-16: Paused further implementation after identifying that
  `supportsMultiCluster` preserved the old global-orchestrator scope model
  rather than the desired product model. The follow-up phase should remove
  multi-cluster resource-stream scope support instead of building on it.

## Phase 2: Single-Cluster Resource Stream Contract

- [x] Remove `supportsMultiCluster` from resource stream domain descriptors.
- [x] Make `ResourceStreamManager` accept only single-cluster resource scopes.
- [x] Replace resource stream multi-cluster fan-in with explicit per-cluster
      fan-out at the coordinator/background-refresh boundary.
- [x] Keep background refresh for open clusters by invoking per-cluster refresh
      work separately for each background `clusterId`.
- [x] Remove multi-cluster merge paths from resource stream snapshot handling
      once no caller can pass multi-cluster resource scopes.
- [x] Add tests proving resource stream scopes are single-cluster and that
      background refresh still refreshes non-active clusters independently.
- [x] Keep or explicitly document aggregate behavior for non-resource-stream
      domains such as `namespaces`.

Progress:

- 2026-05-16: Removed `supportsMultiCluster` from the descriptor contract.
  `ResourceStreamManager` now rejects multi-cluster resource scopes and no
  longer fans one resource stream request into multiple subscriptions. The
  orchestrator rejects multi-cluster resource stream refresh scopes and keeps
  background cluster refresh working through `fetchDomainForCluster`, which
  builds one single-cluster scope per cluster. Focused tests now cover
  descriptor shape, stream rejection, and background per-cluster fetches.
- 2026-05-16: Validation passed with focused refresh tests and
  `mage qc:prerelease`.

## Phase 3: Scope Normalization Boundaries

- [x] Split the generic `RefreshOrchestrator.normalizeScope()` path into
      explicit normalization paths for resource streams, aggregate domains, and
      other scoped domains.
- [x] Make resource stream normalization prefer an explicit single-cluster
      scope when present, otherwise the active foreground `selectedClusterId`.
- [x] Keep aggregate domains such as `namespaces` on a separate path that may
      intentionally use all connected/open clusters.
- [x] Update `setScopedDomainEnabled`, `fetchScopedDomain`,
      `startStreamingDomain`, `stopStreamingDomain`, `refreshStreamingDomainOnce`,
      `restartStreamingDomain`, and `resetScopedDomain` to use the appropriate
      normalization path.
- [x] Add tests proving unprefixed resource stream scopes resolve to the active
      cluster, multi-cluster resource stream scopes are rejected, and aggregate
      domains can still normalize aggregate scopes.
- [x] Add regression coverage for active-cluster switches with multiple
      background clusters open.

Progress:

- 2026-05-16: Replaced the generic orchestrator scope normalization path with
  domain-aware normalization. Resource stream domains now bind unprefixed
  scopes to the active foreground cluster and still reject explicit
  multi-cluster scopes. Aggregate domains use the connected/open cluster set.
  Public scoped-domain operations now route through the domain-aware normalizer.
  Added tests for active-cluster resource scopes, active tab switches with
  background clusters open, and aggregate-domain normalization.
- 2026-05-16: Validation passed with focused refresh tests and
  `mage qc:prerelease`.

## Phase 4: Per-Cluster Runtime Boundary

- [x] Introduce a small per-cluster runtime abstraction under the global
      refresh coordinator.
- [x] Move per-cluster domain enablement state into the runtime or behind a
      runtime-aware API.
- [x] Move per-cluster in-flight request tracking and cancellation behind the
      runtime.
- [x] Move per-cluster stream health and telemetry behind runtime-aware APIs.
- [x] Route background refresh through runtime lookup instead of building
      ad hoc cluster-scoped calls in the coordinator.
- [x] Keep aggregate/system domains that truly span clusters owned by the
      global coordinator.
- [x] Keep global settings, visibility, kubeconfig lifecycle, auth
      pause/recovery, and diagnostics aggregation in the coordinator.
- [x] Add tests for active-cluster switches, background cluster refresh,
      cluster removal, auth failure/recovery, and diagnostics aggregation.

Progress:

- 2026-05-16: Added `ClusterRefreshRuntime` and routed single-cluster resource
  domain state through per-cluster runtimes. The coordinator now owns only
  aggregate/global state for domains such as `namespaces` and
  `cluster-overview`.
- 2026-05-16: Moved scoped enablement, in-flight request tracking, stream
  startup/cleanup bookkeeping, stream health, blocked-stream state, and
  metrics refresh telemetry behind runtime-aware lookup. Background cluster
  snapshot refresh now creates/uses the target cluster runtime before fetching.
- 2026-05-16: Added runtime pruning when `allConnectedClusterIds` removes a
  cluster. Removed runtimes stop streaming, abort in-flight work, clear
  transient telemetry, and reset their scoped refresh state.
- 2026-05-16: Added regression tests for cluster-runtime ownership,
  aggregate-domain coordinator ownership, background cluster refresh, cluster
  removal, stream drift/health ownership, and auth failure/recovery restart
  behavior. Focused validation passed:
  `npm --prefix frontend run test -- src/core/refresh/orchestrator.test.ts src/core/refresh/streaming/resourceStreamManager.test.ts src/core/refresh/streaming/resourceStreamDomains.test.ts src/modules/kubernetes/config/KubeconfigContext.test.tsx src/core/refresh/hooks/useBackgroundRefresh.test.tsx`.
- 2026-05-16: Full validation passed with `mage qc:prerelease`.

## Phase 5: Resource Snapshot And Row Merge Simplification

- [x] Extract pure row merge helpers out of the stream manager.
- [x] Add descriptor-driven collection accessors for domains whose snapshot
      application is now "write payload, update stats, clear error."
- [x] Replace repeated `applySnapshot` branches with a shared single-cluster
      snapshot writer where the behavior is identical.
- [x] Keep explicit handlers for domains that genuinely need custom behavior.
- [x] Keep metrics-preserving merge behavior for pods, workloads, and nodes.
- [x] Add focused tests for row replacement, metrics preservation, deletion,
      cluster-isolated replacement, and stable row reuse.
- [x] Verify drift detection uses the same identity rule as row merging.
- [x] Keep refresh-store mutation in the manager until the pure behavior is
      fully covered.

Progress:

- 2026-05-16: Extracted pure stream row behavior into
  `resourceStreamRows.ts`, including metric-preserving row merge helpers,
  stable row reuse, deletion handling, and single-cluster snapshot row
  replacement.
- 2026-05-16: Added descriptor-owned row collection accessors for every
  resource stream domain. Stream update application, shadow-key drift tracking,
  and snapshot resync row replacement now all use descriptor row identity.
- 2026-05-16: Replaced repeated `ResourceStreamManager.applySnapshot` branches
  with a shared writer that keeps refresh-store mutation in the manager while
  delegating row extraction, identity, sorting, and payload reconstruction to
  descriptors.
- 2026-05-16: Added focused tests for descriptor collection contracts,
  descriptor drift-key parity, pure row deletion, stable row reuse, and
  cluster-isolated snapshot row replacement. Focused validation passed:
  `npm --prefix frontend run test -- src/core/refresh/streaming/resourceStreamManager.test.ts src/core/refresh/streaming/resourceStreamDomains.test.ts src/core/refresh/streaming/resourceStreamRows.test.ts src/core/refresh/orchestrator.test.ts`
  and `npm --prefix frontend run typecheck`.
- 2026-05-16: Full validation passed with `mage qc:prerelease`.

## Phase 6: Metrics-Only Refresh Simplification

- [x] Re-evaluate `metricsOnly` after per-cluster runtimes own resource stream
      state.
- [x] Move metrics-only refresh decisions out of global multi-domain
      orchestration where possible and into the single-cluster resource runtime.
- [x] Preserve the current behavior that healthy streams can receive metrics
      updates without replacing stream-driven rows.
- [x] Preserve fallback polling when stream health is degraded or unavailable.
- [x] Remove obsolete global metrics-only special cases once per-cluster
      behavior covers them.
- [x] Add tests for metrics freshness, stream fallback, manual refresh,
      background cluster metrics refresh, and restricted-RBAC metrics behavior.

Progress:

- 2026-05-16: Moved streaming fetch-mode selection into
  `ClusterRefreshRuntime`. The owning runtime now decides whether a scoped
  streaming domain should run a normal snapshot, apply a metrics-only snapshot,
  or skip because the stream/metrics state is already fresh.
- 2026-05-16: Removed the coordinator-level metrics freshness helpers. Metrics
  refresh timestamps are still per-cluster runtime state, and metrics-only
  snapshots now record freshness through that runtime after successful
  not-modified or applied snapshot responses.
- 2026-05-16: Added regression tests for active-stream manual refresh,
  unhealthy-stream fallback snapshots, per-cluster metrics freshness isolation,
  background-cluster metrics refresh, and restricted-RBAC metrics errors that
  update metrics status without replacing stream-owned rows. Focused validation
  passed:
  `npm --prefix frontend run test -- src/core/refresh/orchestrator.test.ts src/core/refresh/streaming/resourceStreamManager.test.ts src/core/refresh/streaming/resourceStreamDomains.test.ts src/core/refresh/streaming/resourceStreamRows.test.ts`.
- 2026-05-16: Full validation passed with `mage qc:prerelease`.

## Phase 7: Frontend Connection And Subscription Boundaries

- [x] Extract WebSocket connection lifecycle into a connection module.
- [x] Extract subscription state, pending unsubscribe, and resume token handling
      into a subscription module.
- [x] Keep resync orchestration in the manager until connection/subscription
      tests are in place.
- [x] Add tests for visibility suspend/resume, reconnect, pending reset,
      pending unsubscribe, complete/error handling, and kubeconfig-change stop.

Progress:

- 2026-05-16: Extracted `ResourceStreamConnection` into
  `resourceStreamConnection.ts`. The connection module now owns WebSocket URL
  resolution, open/message/error/close handling, queued outbound messages,
  pause/resume, close, reconnect backoff, jitter, and refresh base URL
  invalidation.
- 2026-05-16: Extracted `ResourceStreamSubscriptionStore` into
  `resourceStreamSubscriptions.ts`. The subscription module now owns
  single-cluster scope resolution, subscription creation/lookup, pending
  unsubscribe debounce/cancel state, request/cancel message construction, and
  resume token handling.
- 2026-05-16: Kept snapshot resync orchestration, drift detection, health
  aggregation, telemetry, and refresh-store mutation in `ResourceStreamManager`.
  Added focused tests for connection lifecycle, subscription resume/debounce
  behavior, visibility suspend/resume, reconnect/resubscribe, pending reset
  acknowledgement, pending unsubscribe cancellation, complete/error resync, and
  kubeconfig cleanup. Focused validation passed:
  `npm --prefix frontend run test -- src/core/refresh/orchestrator.test.ts src/core/refresh/streaming/resourceStreamManager.test.ts src/core/refresh/streaming/resourceStreamConnection.test.ts src/core/refresh/streaming/resourceStreamSubscriptions.test.ts src/core/refresh/streaming/resourceStreamDomains.test.ts src/core/refresh/streaming/resourceStreamRows.test.ts`
  and `npm --prefix frontend run typecheck`.
- 2026-05-16: Full validation passed with `mage qc:prerelease`.

## Phase 8: Backend Update Projection Helpers

- [ ] Add a small helper for constructing common `resourcestream.Update`
      metadata from Kubernetes object metadata.
- [ ] Apply it to straightforward handlers first: config maps, secrets, RBAC,
      storage, admissions, and simple network resources.
- [ ] Keep special-case handlers explicit: pods, endpoint slices, workloads,
      custom resources, Helm release resync signals.
- [ ] Add tests around one simple handler per domain family before broadening.

## Phase 9: Backend Registration And Handler Descriptors

- [ ] Introduce backend stream resource descriptors for straightforward
      informer handlers.
- [ ] Use descriptors to register informer handlers where no special behavior
      is required.
- [ ] Keep permission gates aligned with `backend/refresh/system/registrations.go`.
- [ ] Add a test that descriptor-backed resources have matching domain,
      resource, and permission metadata.

## Phase 10: Parity Guardrails

- [ ] Add tests that compare streamed domain descriptors with refresh domain
      registrations.
- [ ] Add tests that each streamed frontend domain has a row identity, sort,
      and drift strategy.
- [ ] Add tests that resource WebSocket domains reject multi-cluster scopes.
- [ ] Add tests that background refresh fans out across cluster runtimes instead
      of creating multi-cluster resource scopes.
- [ ] Add backend tests that each streamed built-in resource produces
      `clusterId`, resource version, kind, namespace where applicable, and row
      payloads matching the snapshot shape.
- [ ] Document the descriptor pattern in `docs/architecture/refresh-system.md`.

## Validation

During implementation, use targeted checks first:

```bash
npm run test -- src/core/refresh/streaming/resourceStreamManager.test.ts
npm run test -- src/core/refresh/orchestrator.test.ts
npm run test -- src/modules/kubernetes/config/KubeconfigContext.test.tsx
npm run test -- src/core/refresh/hooks/useBackgroundRefresh.test.tsx
go test ./backend/refresh/resourcestream ./backend/refresh/system ./backend/refresh/snapshot
```

Before considering the work complete:

```bash
mage qc:prerelease
```

After `mage qc:prerelease`, inspect the worktree because the gate can run
frontend lint fixes.

## Rollout Notes

This should be done incrementally. The next milestone should be scope
normalization boundaries. Do not continue extracting row merge, metrics-only
refresh, or connection lifecycle code until resource-stream scope ownership is
explicit, because otherwise the extracted modules will preserve ambiguous
cluster ownership.

## Open Questions

No open product questions at this point. The current working assumption is that
only one cluster is active in the foreground, background clusters refresh via
explicit per-cluster fan-out, and resource WebSocket domains should never use
multi-cluster scopes.
