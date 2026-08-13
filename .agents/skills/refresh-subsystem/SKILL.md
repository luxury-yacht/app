---
name: refresh-subsystem
description: Modify Luxury Yacht refresh domains, snapshots, streams, doorbells, polling fallback, diagnostics, retained data, or refresh lifecycle while preserving cross-layer ordering and recovery contracts
user-invocable: false
---

# Refresh Subsystem

Choose the changed contract first; do not load every refresh document or
reference for a narrow task.

## Route context

| Change | Read |
| --- | --- |
| Domain/scope/query envelope | `docs/architecture/refresh-system.md`, [domain wiring](references/domain-wiring.md) |
| Store, ingest, governor, Cold/retained serving | `docs/architecture/data-layer.md`, relevant lifecycle sections of [fragility](references/fragility.md) |
| Signals, streams, doorbells, polling fallback | `docs/architecture/data-freshness.md`, relevant signal sections of [fragility](references/fragility.md) |
| Metrics joins, staleness, metric clock | `docs/architecture/resource-metrics.md`, metric sections of [fragility](references/fragility.md) |
| Cross-cluster scope or selection | `docs/architecture/multi-cluster.md`, [domain wiring](references/domain-wiring.md) |

Read [fragility](references/fragility.md) only when the task touches a named failure-prone
path. Use its headings to select the relevant section rather than loading it for
ordinary DTO or local snapshot projection work.

## Core contracts

- Per-cluster initialization order is informer factory and permission checker,
  permission preflight, ordered domain registration, snapshots/queues/streams,
  manager start, then revalidation. Publish aggregate request/response and
  stream routing only after their owning aggregates are ready. Wails owns the
  `/api/v2` service route and named-stream registration; do not add an
  application-owned loopback server.
- `buildRefreshSubsystemForSelection` is the construction chokepoint for startup,
  selector-open, recovery, and governor re-warm. Per-cluster readiness,
  invalidation, and lifecycle wiring belong there.
- Refresh scopes target one cluster. Aggregate display fans out above refresh
  state; handlers route results rather than merging clusters.
- The shared refresh-domain contract owns cross-layer metadata. Generated types
  are regenerated, never hand-edited.
- Snapshot and stream rows share projection helpers and parity tests. Stream
  identity crosses the wire in the top-level full `ref`.
- New table/list domains require change-signal coverage. Polling is a stream-down
  fallback unless a documented conditional producer requires poll augmentation.
- Snapshot cache keys, invalidation, source clocks, signal clocks, and query
  revisions are one ordering contract; trace producer through rendered consumer
  before changing any of them.

## Workflow

1. Identify domain, scope, producer, signal source, cache owner, and every
   frontend consumer.
2. Prove registration/permission ordering and both sides of any readiness gate.
3. Write the failing regression test at the contract boundary.
4. Change backend and frontend mappings together when the shared contract moves.
5. Exercise restricted RBAC and multiple connected clusters when affected.
6. Check diagnostics, teardown, and fallback behavior before the root final
   validation gate.

## Focused checks

Choose packages/specs matching the change:

```sh
mise exec -- go test ./backend/refresh/snapshot ./backend/refresh/system
mise exec -- go test ./backend/refresh/resourcestream/...
mise exec -- npm run test --prefix frontend -- refresh streaming
mise exec -- npm run typecheck --prefix frontend
```

For runtime wedges, capture a goroutine dump before modifying synchronization;
see `docs/workflows/goroutine-dump.md`. Verify payload-shape claims against the
actual snapshot endpoint when the local app is reachable.
