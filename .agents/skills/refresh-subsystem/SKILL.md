---
name: refresh-subsystem
description: Modify Luxury Yacht refresh domains, snapshots, streams, doorbells, polling fallback, diagnostics, retained data, or refresh lifecycle while preserving cross-layer ordering and recovery contracts
user-invocable: false
---

# Refresh Subsystem

Choose the changed contract first; do not load every refresh document or
reference for a narrow task.

## Task routes

| Change | Read |
| --- | --- |
| Domain, scope, payload, registration, generated types | [domain wiring](references/domain-wiring.md), `docs/architecture/refresh-system.md` |
| Transport, construction, runtime state, readiness, caches, diagnostics | `docs/architecture/refresh-system.md` |
| Signals, doorbells, polling fallback, retention, leases, request intents | `docs/architecture/data-freshness.md` |
| Store, ingest, governor, Cold/retained serving | `docs/architecture/data-layer.md` |
| Metrics joins, staleness, metric clock | `docs/architecture/resource-metrics.md` |
| Frontend read brokers and correlation | `docs/architecture/data-access.md` |
| Cross-cluster scope or selection | `docs/architecture/multi-cluster.md` |
| A named failure-prone path or a debugging session | matching section of [fragility](references/fragility.md) |

## Workflow

1. Identify the domain, scope, producer, signal source, cache owner, and every
   frontend consumer. Treat snapshot cache keys, invalidation, source clocks,
   signal clocks, and query revisions as one ordering contract.
2. Change backend and frontend mappings together when the shared contract
   moves.
3. Exercise restricted RBAC and multiple connected clusters when affected;
   check diagnostics, teardown, and fallback behavior.
4. Verify payload-shape and cache claims against the real snapshot endpoint
   when the local app is reachable.

## Focused checks

Choose packages/specs matching the change:

```sh
mise exec -- go test ./backend/refresh/snapshot ./backend/refresh/system
mise exec -- go test ./backend/refresh/resourcestream/...
mise exec -- npm run test --prefix frontend -- refresh streaming
mise exec -- npm run typecheck --prefix frontend
```

For runtime wedges, capture a goroutine dump before modifying synchronization;
see `docs/workflows/goroutine-dump.md`.
