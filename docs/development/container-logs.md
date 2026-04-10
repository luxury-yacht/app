# Container log streaming

This document explains how pod log retrieval and rendering works in the Object Panel.

## Scope format

Object-backed log views use the same cluster-aware object scope format as the rest of the refresh system:

- namespaced objects: `clusterId|namespace:group/version:kind:name`
- cluster-scoped objects still use `__cluster__` for the namespace token internally, but pod logs only support namespaced objects

The log backend now rejects versionless object scopes. Pod logs are no longer the one legacy exception to full object identity.

## Backend pipeline

There are two retrieval modes:

1. live stream via `/api/v2/stream/logs`
2. manual or fallback fetch via `LogFetcher`

Both modes now share the same selection semantics:

- resolve the target object from the canonical object scope
- list matching pods for the selected pod or workload
- apply exact pod selection plus optional pod include/exclude regex filters
- apply exact container selection plus optional init/ephemeral inclusion flags and container-state targeting
- apply per-scope and global pod/container target caps
- apply source-side line include/exclude regex filters
- emit warnings when the visible target set is degraded by caps

The backend only delivers logs plus metadata and warnings. It does not format parsed JSON views or user-defined output layouts.

## Frontend pipeline

The frontend owns display and interaction:

- panel-lifetime filter persistence
- stream parameter caching across transient unmounts
- raw / structured JSON / pretty JSON / parsed-table display modes
- timestamp display modes
- highlight rendering
- copy behavior for the active display mode
- buffering and cached re-render on reconnects

Structured and parsed JSON views are frontend-only. The backend still ships flat log lines with metadata.

## Selection semantics

When the viewer is not pinned to one exact container, backend selection now supports:

- include or exclude init containers
- include or exclude ephemeral containers
- container state filters: `all`, `running`, `waiting`, `terminated`

Exact container selection bypasses those broader class and state filters so a user can still request a specific init or ephemeral container directly.

## Adopted behaviors

The object-scoped logs tab intentionally adopts these behaviors:

- full cluster-aware and GVK-aware object identity
- source-side pod, container, and line filtering
- explicit per-scope and global fan-out caps
- deterministic target ordering
- ephemeral containers included by default in "all containers"
- stable hash-based pod colors using the existing 12-color palette
- frontend-owned structured display modes and timestamp modes

## Omitted behaviors

These are intentionally not part of the Object Panel logs tab:

- arbitrary workload discovery by regex
- cluster-wide or all-namespace freeform log search
- label, field, or node selectors beyond the selected object
- backend-side parsed-log rendering
- user-defined template rendering

## Implementation notes

### 1. Don't call both `setScopedDomainEnabled` and `startStreamingDomain`

The log viewer component uses the refresh orchestrator to manage log streaming. There are two key constraints.

The `setScopedDomainEnabled(domain, scope, true)` function internally schedules streaming via `scheduleStreamingStart`. If you also call `startStreamingDomain` separately, this creates a race condition with the orchestrator's `pendingStreaming` deduplication.

In React Strict Mode, effects run twice during development. When the first effect invocation starts streaming, the `pendingStreaming` map blocks the second invocation. If the cleanup from the first effect runs before streaming completes, it stops the connection. Meanwhile, the second invocation is blocked and never starts its own stream. The result is that streaming fails to establish.

Correct:

```typescript
refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
```

Incorrect:

```typescript
refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
void refreshOrchestrator.startStreamingDomain(LOG_DOMAIN, logScope);
```

### 2. Reset state during render, not in effects

When the log scope changes, the component resets its internal state. This reset should happen during the render phase, not in an effect, to avoid triggering a re-render that interrupts streaming startup.

### 3. Backend sends two initial events

The backend log stream handler sends two events when a stream connects:

1. connected event (`sequence=1`) with `reset=true` and empty entries
2. initial logs event (`sequence>=2`) after the initial fetch completes, even if it is empty

The frontend uses that contract to distinguish:

- `sequence < 2`: still loading
- `sequence >= 2`: initial fetch complete

That prevents the UI from showing "No logs available" while the backend is still fetching the initial tail.

### 4. Fallback/manual fetch uses the same object identity as live streaming

The logs tab no longer has a separate legacy identity path for manual fetch. The stream URL scope and the `LogFetcher` request scope both come from the same `logScope` value produced by `getObjectPanelKind`.
