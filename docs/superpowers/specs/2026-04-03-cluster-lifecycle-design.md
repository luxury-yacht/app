# Cluster Lifecycle State Design

## Overview

A unified per-cluster lifecycle state machine owned by the Go backend, with events emitted to the frontend. Replaces the current fragmented approach where auth, connection, domain loading, and readiness are tracked independently across multiple systems with no aggregation.

## Problem

There is no way to ask "what state is cluster X in?" Multiple systems independently track pieces:
- Auth state in `AuthErrorContext`
- Connection state globally in `ConnectionStatusProvider`
- Domain loading per-domain in the refresh store
- Namespace loading derived in `NamespaceContext`
- Overview hydration as local state in `ClusterOverview`

This caused the favorites navigation bug (navigating to a view before the cluster is ready) and will affect any future feature that needs cluster readiness (preemptive permissions, background operations, multi-window support).

## Lifecycle States

```
connecting      — Kubernetes API client creation in progress
auth_failed     — Credentials rejected or expired
connected       — API client ready, no data fetched yet
loading         — Initial data fetch in progress (namespaces, catalog, overview)
loading_slow    — Initial load taking longer than 10 seconds
ready           — Initial load complete, cluster is fully usable
disconnected    — Connection lost
reconnecting    — Attempting to restore connection
```

## State Transitions

```
connecting    → connected | auth_failed | disconnected
auth_failed   → connecting (retry)
connected     → loading
loading       → ready | loading_slow | disconnected | auth_failed
loading_slow  → ready | disconnected | auth_failed
ready         → disconnected | auth_failed
disconnected  → reconnecting
reconnecting  → connected | auth_failed | disconnected
```

The `loading → loading_slow` transition fires from a 10-second timer started on entry to `loading`. The timer is cancelled if the state transitions before it fires.

The `loading → ready` transition fires when the namespaces domain completes its first successful fetch for this cluster. Namespaces is the gating requirement — the catalog and overview load in the background, and individual views handle their own loading states.

## Backend Architecture

### New file: `backend/cluster_lifecycle.go`

Owns a per-cluster state map and transition logic:

```go
type ClusterLifecycleState string

const (
    ClusterStateConnecting    ClusterLifecycleState = "connecting"
    ClusterStateAuthFailed    ClusterLifecycleState = "auth_failed"
    ClusterStateConnected     ClusterLifecycleState = "connected"
    ClusterStateLoading       ClusterLifecycleState = "loading"
    ClusterStateLoadingSlow   ClusterLifecycleState = "loading_slow"
    ClusterStateReady         ClusterLifecycleState = "ready"
    ClusterStateDisconnected  ClusterLifecycleState = "disconnected"
    ClusterStateReconnecting  ClusterLifecycleState = "reconnecting"
)
```

Each transition emits a Wails event:
```go
runtime.EventsEmit(ctx, "cluster:lifecycle", map[string]string{
    "clusterId":     clusterId,
    "state":         string(newState),
    "previousState": string(previousState),
})
```

When a cluster is removed from `selectedKubeconfigs`, its lifecycle entry is cleaned up.

### Exported methods on `*App`:

- `GetAllClusterLifecycleStates() map[string]ClusterLifecycleState` — for frontend hydration on mount/hot reload

### Integration points with existing code:

| Transition | Trigger location |
|---|---|
| → `connecting` | `initKubernetesClient` starts for a new cluster |
| → `auth_failed` | Auth provider returns error, or `cluster:auth:failed` handler |
| → `connected` | `initKubernetesClient` succeeds (where `kubeconfig:changed` fires) |
| → `loading` | Immediately after `connected` (back-to-back transition) |
| → `loading_slow` | 10-second `time.AfterFunc` goroutine started on entry to `loading` |
| → `ready` | Namespaces refresh completes successfully for this cluster |
| → `disconnected` | API request fails with connection error, or health check failure |
| → `reconnecting` | Existing reconnection logic starts retry |

## Frontend Architecture

### New file: `frontend/src/core/contexts/ClusterLifecycleContext.tsx`

**Provider:**
- Subscribes to `cluster:lifecycle` events via Wails `EventsOn`
- Maintains `Map<string, ClusterLifecycleState>` keyed by cluster ID
- Cleans up entries when clusters are removed from `selectedClusterIds`
- Hydrates on mount via `GetAllClusterLifecycleStates()` RPC

**Hook:**
```typescript
const { getClusterState, isClusterReady } = useClusterLifecycle();

getClusterState(clusterId)  // returns the state string
isClusterReady(clusterId)   // convenience: state === 'ready'
```

**Provider placement:** Inside `KubernetesProvider`, before `FavoritesProvider`.

## Favorites Integration

The navigation effect in `FavoritesContext` currently fires when `selectedKubeconfig` matches the favorite's cluster. It adds one more gate:

```typescript
const clusterState = getClusterState(targetClusterId);
if (clusterState !== 'ready') return;
```

The effect re-runs when the lifecycle state changes. When it transitions to `ready`, the navigation applies. The `queueMicrotask` hack in the current implementation is removed — the `ready` state IS the signal that the cluster has settled.

For generic favorites (any cluster), the gate checks the active cluster's state.

## ConnectivityStatus Integration

The `ConnectivityStatus` component in the header is updated to show the active cluster's lifecycle state:

| State | Label |
|---|---|
| `connecting` | "Connecting..." |
| `auth_failed` | "Auth Failed" (warning styling) |
| `connected` / `loading` | "Loading..." |
| `loading_slow` | "Loading (taking longer than expected)..." |
| `ready` | "Ready" |
| `disconnected` | "Disconnected" (error styling) |
| `reconnecting` | "Reconnecting..." |

The indicator updates when the user switches cluster tabs. The existing refresh button is kept. The existing `ConnectionStatusProvider` global state is retained for app-wide issues (e.g. Wails bridge down) but per-cluster state comes from lifecycle.

## Not In Scope

- UI changes to cluster tabs (loading indicators, warning dots)
- Replacing ClusterOverview's local hydration tracking with lifecycle state
- LoadingSlow UI messaging in the Overview page
- Configurable slow-loading threshold
