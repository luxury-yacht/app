# Refresh Streaming Simplification Plan

## Overview

The refresh system is one of the app's core stability surfaces. It keeps
cluster data current across snapshots, resource streams, event streams,
diagnostics, telemetry, manual refreshes, and multi-cluster scope handling.

The current implementation is functional but expensive to extend. The frontend
resource stream manager combines domain registration rules, scope
normalization, connection lifecycle, subscriptions, row merging, sorting,
drift detection, resync behavior, telemetry, and refresh-store writes in one
large module. The backend resource stream manager has a similar concentration
of responsibilities: informer wiring, custom resource informers, subscription
state, buffering, and every per-kind update projection live together.

This plan reduces that complexity without changing the refresh contract.

## Goals

- Make resource stream behavior table-driven where the behavior is already
  repetitive.
- Keep snapshot and streaming row identity aligned for every streamed domain.
- Make it easier to add a resource kind without touching unrelated stream
  lifecycle code.
- Preserve all multi-cluster scope behavior.
- Preserve drift detection, fallback, resync, and diagnostics behavior.
- Add tests that fail when snapshot and stream behavior drift apart.

## Non-Goals

- Do not replace the refresh system or streaming transports.
- Do not change domain names, payload shapes, or store keys.
- Do not change polling, SSE, WebSocket, or manual refresh semantics.
- Do not combine list/table snapshot builders into `backend/resources`.
- Do not remove diagnostics or telemetry while simplifying.

## Current Hotspots

- `frontend/src/core/refresh/streaming/resourceStreamManager.ts`
  - Supported domain lists and domain categories
  - Scope normalization
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

Introduce explicit stream domain descriptors on both sides.

Frontend descriptors should declare:

- Domain name
- Scope kind: namespace, pod, cluster
- Multi-cluster support
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

## Phase 1: Frontend Domain Descriptors

- [ ] Add a resource stream domain descriptor module.
- [ ] Move supported-domain checks into descriptors.
- [ ] Move multi-cluster and cluster-scoped domain rules into descriptors.
- [ ] Move `normalizeResourceScope` to use descriptor scope kind.
- [ ] Move row sort functions into descriptor entries.
- [ ] Move row key functions into descriptor entries.
- [ ] Derive drift key-set builders from descriptor row keys where possible.
- [ ] Keep the existing `ResourceStreamManager` public API unchanged.
- [ ] Add unit tests for descriptor completeness across every streamed domain.

## Phase 2: Frontend Row Merge Extraction

- [ ] Extract pure row merge helpers out of the stream manager.
- [ ] Keep metrics-preserving merge behavior for pods, workloads, and nodes.
- [ ] Add focused tests for row replacement, metrics preservation, deletion,
      multi-cluster replacement, and stable row reuse.
- [ ] Verify drift detection uses the same identity rule as row merging.
- [ ] Keep refresh-store mutation in the manager until the pure behavior is
      fully covered.

## Phase 3: Frontend Connection And Subscription Boundaries

- [ ] Extract WebSocket connection lifecycle into a connection module.
- [ ] Extract subscription state, pending unsubscribe, and resume token handling
      into a subscription module.
- [ ] Keep resync orchestration in the manager until connection/subscription
      tests are in place.
- [ ] Add tests for visibility suspend/resume, reconnect, pending reset,
      pending unsubscribe, complete/error handling, and kubeconfig-change stop.

## Phase 4: Backend Update Projection Helpers

- [ ] Add a small helper for constructing common `resourcestream.Update`
      metadata from Kubernetes object metadata.
- [ ] Apply it to straightforward handlers first: config maps, secrets, RBAC,
      storage, admissions, and simple network resources.
- [ ] Keep special-case handlers explicit: pods, endpoint slices, workloads,
      custom resources, Helm release resync signals.
- [ ] Add tests around one simple handler per domain family before broadening.

## Phase 5: Backend Registration And Handler Descriptors

- [ ] Introduce backend stream resource descriptors for straightforward
      informer handlers.
- [ ] Use descriptors to register informer handlers where no special behavior
      is required.
- [ ] Keep permission gates aligned with `backend/refresh/system/registrations.go`.
- [ ] Add a test that descriptor-backed resources have matching domain,
      resource, and permission metadata.

## Phase 6: Parity Guardrails

- [ ] Add tests that compare streamed domain descriptors with refresh domain
      registrations.
- [ ] Add tests that each streamed frontend domain has a row identity, sort,
      and drift strategy.
- [ ] Add backend tests that each streamed built-in resource produces
      `clusterId`, resource version, kind, namespace where applicable, and row
      payloads matching the snapshot shape.
- [ ] Document the descriptor pattern in `docs/architecture/refresh-system.md`.

## Validation

During implementation, use targeted checks first:

```bash
npm run test -- src/core/refresh/streaming/resourceStreamManager.test.ts
npm run test -- src/core/refresh/orchestrator.test.ts
go test ./backend/refresh/resourcestream ./backend/refresh/system ./backend/refresh/snapshot
```

Before considering the work complete:

```bash
mage qc:prerelease
```

After `mage qc:prerelease`, inspect the worktree because the gate can run
frontend lint fixes.

## Rollout Notes

This should be done incrementally. The safest first milestone is frontend-only
descriptor extraction for row keys, sorting, and scope rules, because it can be
covered by pure tests before touching stream lifecycle behavior.
