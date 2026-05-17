---
name: refresh-subsystem
description: Guide for safely modifying the refresh/streaming subsystem — covers the full domain lifecycle, registration points, and known fragility areas
user-invocable: false
---

# Refresh Subsystem Guide

This subsystem is **fragile**. Changes historically break things. Read this before touching any refresh, streaming, snapshot, or domain code.

## Architecture Overview

The refresh subsystem manages how Kubernetes resource data flows from clusters to the UI. Each connected cluster gets its own independent subsystem (manager, registry, informers, permission checker). An aggregate layer multiplexes across clusters for the HTTP API.

```
Kubernetes API
    ↓ (informers / polling)
Per-Cluster Subsystem (manager, registry, informers, permissions)
    ↓ (snapshots, SSE, WebSocket)
Aggregate Mux (routes requests to correct cluster)
    ↓ (HTTP API on loopback)
Frontend RefreshManager + RefreshOrchestrator
    ↓ (per-cluster runtimes, stream managers, store writes)
React UI
```

The frontend has one global coordinator for app lifecycle concerns, with per-cluster runtimes underneath it. Each runtime owns enabled scopes, in-flight work, stream health, metrics freshness, and streaming cleanup for exactly one cluster. Refresh domains are single-cluster by contract; background cluster refresh fans out as separate per-cluster requests instead of using multi-cluster refresh scopes.

```
Global coordinator
    ↓
ClusterRefreshRuntime(cluster-a)  ClusterRefreshRuntime(cluster-b)
    ↓                             ↓
single-cluster snapshots/streams  single-cluster snapshots/streams
    ↓ (callbacks, store updates)
React UI
```

## Initialization Sequence

Order matters. Don't rearrange.

1. Create refresh context with cancel
2. Start heartbeat loop
3. **Per cluster:**
   a. Create informer factory + permission checker
   b. Prime permissions (preflight cache warming) — **BEFORE** domain registration
   c. Register domains (universal runtime check + gate logic) — **AFTER** preflight
   d. Create snapshot service, manual queue, stream managers
   e. Start manager (informers + metrics polling)
   f. Start permission revalidation loop
4. Build aggregate mux wiring all clusters
5. Start HTTP server on loopback

**Key files:**

- `backend/app_refresh_setup.go` — orchestrates steps 1-5
- `backend/app_refresh_update.go` — updates active per-cluster subsystems without restarting the HTTP server
- `backend/app_refresh_subsystems.go` — replaces aggregate subsystem state and shared handlers
- `backend/app_refresh_recovery.go` — teardown, auth recovery, transport rebuild
- `backend/refresh/system/manager.go` — per-cluster subsystem creation

## Domain Registration

### Backend

Domains are registered in a fixed order in `backend/refresh/system/registrations.go`. **Order matters** — some domains depend on others (e.g., `cluster-crds` before `cluster-custom`).

Three registration kinds:

| Kind        | Permission Gate                               | Fallback                   |
| ----------- | --------------------------------------------- | -------------------------- |
| `direct`    | None — always registers                       | None                       |
| `list`      | Checks list permission for required resources | Skips if denied            |
| `listWatch` | Checks list + watch permissions               | Can fall back to list-only |

**Two-layer permission checking:**

1. **Preflight** — bulk SSAR calls to warm the cache at startup
2. **Per-domain runtime check** — `defaultPermissionChecks()` in `backend/refresh/snapshot/permission_checks.go`

To register a new domain, add it to `domainRegistrations()` in `registrations.go`. Consider:

- What permissions does it need? Add checks to `defaultPermissionChecks()` in `permission_checks.go`
- Does it need informers? Register them in `backend/refresh/informer/factory.go`
- What order? Place it after any domains it depends on

### Frontend

Every backend domain has a frontend counterpart:

| File                                                                         | What to update                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------- |
| `frontend/src/core/refresh/types.ts`                                         | Add to `RefreshDomain` union + `DomainPayloadMap` |
| `frontend/src/core/refresh/refresherTypes.ts`                                | Add refresher name + map view to refresher        |
| `frontend/src/core/refresh/refresherConfig.ts`                               | Add interval/cooldown/timeout config              |
| `frontend/src/core/refresh/orchestrator.ts`                                  | Register domain with orchestrator                 |
| `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts` | Add domain→refresher and domain→stream mappings   |

**These must stay synchronized.** A backend domain without a frontend mapping breaks diagnostics. A frontend refresher without a backend domain gets empty snapshots.

Resource WebSocket domains also require:

| File                                                                      | What to update                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `frontend/src/core/refresh/streaming/resourceStreamDomains.ts`            | Scope kind, row collection, row identity, sort, drift keys, metric preservation |
| `frontend/src/core/refresh/streaming/resourceStreamRows.ts`               | Pure row replacement, deletion, stable reuse, and metrics-preserving merge logic |
| `frontend/src/core/refresh/streaming/resourceStreamConnection.ts`         | WebSocket connection lifecycle, queued sends, reconnect, pause/resume           |
| `frontend/src/core/refresh/streaming/resourceStreamSubscriptions.ts`      | Single-cluster scope resolution, subscription state, unsubscribe debounce, resume tokens |
| `backend/refresh/resourcestream/domains.go`                               | Supported streamed refresh domain list                                          |
| `backend/refresh/resourcestream/stream_registration_*.go`                 | Informer registration and lister/indexer setup                                  |
| `backend/refresh/resourcestream/update_helpers_test.go` and manager tests | Stream envelope metadata and row-shape parity                                   |

Resource stream descriptors describe row behavior only. Domain descriptors must
not reintroduce multi-cluster capability flags; cross-cluster UI should derive
from separate per-cluster domain state above the refresh store.

`ResourceStreamManager` should remain responsible for refresh-store mutation,
snapshot resync, drift detection, health, telemetry, and fallback decisions.
Keep connection lifecycle in `ResourceStreamConnection`, subscription mechanics
in `ResourceStreamSubscriptionStore`, and pure row math in
`resourceStreamRows.ts`.

## Snapshot Building

**File:** `backend/refresh/snapshot/service.go`

- Uses singleflight to deduplicate concurrent builds for the same cache key
- Cache bypass appends `:bypass` to key to isolate from normal requests
- **Caching rules:**
  - Truncated snapshots are NOT cached
  - Partial batches are NOT cached
  - Only final batches are cached

## Streaming

Four stream types use the refresh HTTP server, with different transports:

| Stream         | Transport         | Backend                                      | Frontend                                                            |
| -------------- | ----------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Events         | SSE (EventSource) | `backend/refresh/eventstream/`               | `frontend/src/core/refresh/streaming/eventStreamManager.ts`         |
| Resources      | WebSocket         | `backend/refresh/resourcestream/`            | `frontend/src/core/refresh/streaming/resourceStreamManager.ts`      |
| Catalog        | SSE (EventSource) | `backend/refresh/snapshot/catalog_stream.go` | `frontend/src/core/refresh/streaming/catalogStreamManager.ts`       |
| Container logs | SSE (EventSource) | `backend/refresh/containerlogsstream/`       | `frontend/src/core/refresh/streaming/containerLogsStreamManager.ts` |

**Event stream resume:** Backend buffers recent events in a circular buffer per scope. On reconnect, frontend sends `?since=<sequence>` to resume. If the buffer overflowed, resume returns empty and the client must re-snapshot. **Resume is not guaranteed.**

**Resource stream resume:** Resource WebSocket subscriptions are keyed by a single cluster, domain, and normalized scope. The frontend sends resume tokens per subscription; expired buffers trigger `RESET` and a snapshot resync. Multi-cluster resource stream scopes are rejected on both the frontend subscription path and backend stream mux path, matching the broader single-cluster refresh-domain contract.

**Stream endpoints:**

- `/api/v2/stream/events`
- `/api/v2/stream/resources`
- `/api/v2/stream/catalog`
- `/api/v2/stream/container-logs`

## RefreshManager (Frontend)

**File:** `frontend/src/core/refresh/RefreshManager.ts`

Lifecycle per refresher: `idle → refreshing → cooldown → idle`

Key behaviors:

- Callbacks run via `Promise.allSettled` — one failure doesn't kill others, but the refresh is marked failed
- Exponential backoff on errors: `cooldown * 2^(errorCount-1)`, capped at 60s
- Context changes (namespace, cluster, view) abort affected refreshers then re-trigger
- Global pause blocks automatic refresh but not manual refresh
- Visibility: streams suspend on hidden tab, resume on visible

## Resource Stream Registration

Backend resource stream registration is split by behavior:

| File                             | Purpose                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| `stream_registration_helpers.go` | Permission checks and Add/Update/Delete event mapping                    |
| `stream_registration_direct.go`  | Direct object-to-stream handlers without manager listers/indexers        |
| `stream_registration_network.go` | Network and Gateway API handlers, including service/route/policy listers |
| `stream_registration_related.go` | Pod/node/workload registrations that seed related-object lookup state    |
| `domains.go`                     | Supported resource stream domain list used for parity guardrails         |

Keep permission checks before lazy informer creation. Do not replace these files with a large descriptor table if the behavior-specific split is clearer.
Ordinary object updates may use shared `newObjectUpdate`/`newObjectRowUpdate`
helpers, but keep pods, endpoint slices, workloads, custom resources,
node-derived updates, and Helm resync signals explicit.

## Known Fragility Points

### Things that break easily

1. **Permission gate ordering** — Preflight must run before domain registration. Domain registration order is fixed. Moving things around causes cascading failures where later domains can't find data from earlier ones.

2. **Metrics polling** — Can be disabled for two different reasons (permissions vs discovery) with different UI messages. Getting the disabled reason wrong makes diagnostics confusing.

3. **Multi-cluster add/remove** — Aggregate handlers must be updated via the update path, not just init. They route requests to per-cluster subsystems; they must not merge multiple clusters into one refresh-domain result.

4. **Refresh scope ownership** — Refresh domains must target exactly one cluster. Do not pass multi-cluster scopes to snapshot, manual refresh, or resource stream domains; fan out to per-cluster runtimes instead.

5. **Stream reconnection** — Event/resource buffer overflow means resume fails and the frontend must fall back to full re-snapshot. If this detection is wrong, the UI shows stale data with no indication.

6. **Rapid context changes** — Switching namespaces/clusters quickly can leave refreshers in undefined state. The abort→retrigger path has race conditions if context updates arrive faster than abort completes.

7. **Informer shutdown** — `Shutdown()` clears references but doesn't stop informers (context cancellation does that). If the context isn't cancelled before shutdown, informers leak.

### Before modifying this subsystem

- [ ] Read the specific file you're changing AND its callers
- [ ] Check if domain registration order is affected
- [ ] Check if permission checks need updating (both layers)
- [ ] Check if frontend mappings need updating (types, refresher config, diagnostics)
- [ ] For resource streams, check frontend descriptors, backend supported domains, registration files, and single-cluster scope tests
- [ ] Confirm new refresh-domain code builds one cluster scope at a time and derives any cross-cluster display above refresh state
- [ ] Confirm `namespaces` and `cluster-overview` remain ordinary per-cluster domains, not aggregate-domain exceptions
- [ ] Confirm backend aggregate handlers still route as a mux and do not merge snapshot/manual/event/resource results across clusters
- [ ] For streamed table rows, check descriptor parity tests for row identity, update identity, sorting, empty payloads, and drift keys
- [ ] Check if stream resume semantics are affected
- [ ] Test with multiple clusters connected
- [ ] Test with a cluster that has restricted RBAC (not cluster-admin)
- [ ] Verify diagnostics panel still shows correct status
