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
Frontend RefreshManager + Stream Managers
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
- `backend/app_refresh_recovery.go` — teardown, auth recovery, transport rebuild
- `backend/refresh/system/manager.go` — per-cluster subsystem creation

## Domain Registration

### Backend

Domains are registered in a fixed order in `backend/refresh/system/registrations.go`. **Order matters** — some domains depend on others (e.g., `cluster-crds` before `cluster-custom`).

Three registration kinds:

| Kind | Permission Gate | Fallback |
|------|----------------|----------|
| `direct` | None — always registers | None |
| `list` | Checks list permission for required resources | Skips if denied |
| `listWatch` | Checks list + watch permissions | Can fall back to list-only |

**Two-layer permission checking:**
1. **Preflight** — bulk SSAR calls to warm the cache at startup
2. **Per-domain runtime check** — `defaultPermissionChecks()` in `backend/refresh/snapshot/permission_checks.go`

To register a new domain, add it to `domainRegistrations()` in `registrations.go`. Consider:
- What permissions does it need? Add checks to `defaultPermissionChecks()` in `permission_checks.go`
- Does it need informers? Register them in `backend/refresh/informer/factory.go`
- What order? Place it after any domains it depends on

### Frontend

Every backend domain has a frontend counterpart:

| File | What to update |
|------|----------------|
| `frontend/src/core/refresh/types.ts` | Add to `RefreshDomain` union + `DomainPayloadMap` |
| `frontend/src/core/refresh/refresherTypes.ts` | Add refresher name + map view to refresher |
| `frontend/src/core/refresh/refresherConfig.ts` | Add interval/cooldown/timeout config |
| `frontend/src/core/refresh/orchestrator.ts` | Register domain with orchestrator |
| `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts` | Add domain→refresher and domain→stream mappings |

**These must stay synchronized.** A backend domain without a frontend mapping breaks diagnostics. A frontend refresher without a backend domain gets empty snapshots.

## Snapshot Building

**File:** `backend/refresh/snapshot/service.go`

- Uses singleflight to deduplicate concurrent builds for the same cache key
- Cache bypass appends `:bypass` to key to isolate from normal requests
- **Caching rules:**
  - Truncated snapshots are NOT cached
  - Partial batches are NOT cached
  - Only final batches are cached

## Streaming

Three stream types, each with different transport:

| Stream | Transport | Backend | Frontend |
|--------|-----------|---------|----------|
| Events | SSE (EventSource) | `backend/refresh/eventstream/` | `frontend/src/core/refresh/streaming/eventStreamManager.ts` |
| Resources | WebSocket | `backend/refresh/resourcestream/` | `frontend/src/core/refresh/streaming/resourceStreamManager.ts` |
| Catalog | SSE (EventSource) | `backend/refresh/snapshot/catalog_stream.go` | `frontend/src/core/refresh/streaming/catalogStreamManager.ts` |

**Event stream resume:** Backend buffers recent events in a circular buffer per scope. On reconnect, frontend sends `?since=<sequence>` to resume. If the buffer overflowed, resume returns empty and the client must re-snapshot. **Resume is not guaranteed.**

**Stream endpoints:**
- `/api/v2/stream/events`
- `/api/v2/stream/resources`
- `/api/v2/stream/catalog`
- `/api/v2/stream/logs`

## RefreshManager (Frontend)

**File:** `frontend/src/core/refresh/RefreshManager.ts`

Lifecycle per refresher: `idle → refreshing → cooldown → idle`

Key behaviors:
- Callbacks run via `Promise.allSettled` — one failure doesn't kill others, but the refresh is marked failed
- Exponential backoff on errors: `cooldown * 2^(errorCount-1)`, capped at 60s
- Context changes (namespace, cluster, view) abort affected refreshers then re-trigger
- Global pause blocks automatic refresh but not manual refresh
- Visibility: streams suspend on hidden tab, resume on visible

## Known Fragility Points

### Things that break easily

1. **Permission gate ordering** — Preflight must run before domain registration. Domain registration order is fixed. Moving things around causes cascading failures where later domains can't find data from earlier ones.

2. **Metrics polling** — Can be disabled for two different reasons (permissions vs discovery) with different UI messages. Getting the disabled reason wrong makes diagnostics confusing.

3. **Multi-cluster add/remove** — Aggregate handlers must be updated via the update path, not just init. If a cluster is removed while a refresh is running, the aggregate handler can crash.

4. **Stream reconnection** — Event buffer overflow means resume fails silently. Frontend must detect empty resume and fall back to full re-snapshot. If this detection is wrong, the UI shows stale data with no indication.

5. **Rapid context changes** — Switching namespaces/clusters quickly can leave refreshers in undefined state. The abort→retrigger path has race conditions if context updates arrive faster than abort completes.

6. **Informer shutdown** — `Shutdown()` clears references but doesn't stop informers (context cancellation does that). If the context isn't cancelled before shutdown, informers leak.

### Before modifying this subsystem

- [ ] Read the specific file you're changing AND its callers
- [ ] Check if domain registration order is affected
- [ ] Check if permission checks need updating (both layers)
- [ ] Check if frontend mappings need updating (types, refresher config, diagnostics)
- [ ] Check if stream resume semantics are affected
- [ ] Test with multiple clusters connected
- [ ] Test with a cluster that has restricted RBAC (not cluster-admin)
- [ ] Verify diagnostics panel still shows correct status
