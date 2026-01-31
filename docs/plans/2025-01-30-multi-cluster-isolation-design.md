# Multi-Cluster Isolation Design

## Principle

Every cluster is independent and equal. No "primary" cluster concept. Full isolation. The only UI consideration is which cluster tab is currently active.

---

## Background

Luxury Yacht evolved from single-cluster to multi-cluster support. Legacy code remains that assumes a single cluster, causing:

- Cluster tabs becoming unresponsive when auth errors occur
- Clusters with valid auth not loading data when another cluster fails
- Shared state bleeding between clusters

**Policy violation:** The codebase explicitly contradicts its own documented principle. From `docs/development/multi-cluster-support.md:14`:

> "No 'primary cluster' concept; selection is a set and must not assume a first cluster."

Yet `kubeconfigs.go:446` contains:

> "selections matters (the first selection is the 'primary' cluster)."

This design eliminates all "first cluster" and "primary cluster" concepts.

---

## Section 1: Backend Global Field Removal

**Delete from `app.go`:**

```go
// DELETE these fields entirely:

// Global client fields (lines 31-35)
client               kubernetes.Interface
apiextensionsClient  apiextensionsclientset.Interface
dynamicClient        dynamic.Interface
metricsClient        *metricsclient.Clientset
restConfig           *rest.Config

// Global informer factories (lines 56-57)
sharedInformerFactory        informers.SharedInformerFactory
apiExtensionsInformerFactory apiextinformers.SharedInformerFactory

// Global refresh components (lines 48, 55)
refreshManager    *refresh.Manager
telemetryRecorder *telemetry.Recorder

// Global transport failure tracking (lines 81-85) - see Section 17
transportMu                sync.Mutex
transportFailureCount      int
transportWindowStart       time.Time
transportRebuildInProgress bool
lastTransportRebuild       time.Time

// Global auth recovery flag (line 78-79) - see Section 14
authRecoveryMu        sync.Mutex
authRecoveryScheduled bool
```

**All code accessing these must be updated to:**

- Use `app.clusterClientsForID(clusterID)` for clients
- Use `app.refreshSubsystems[clusterID]` for refresh components
- Pass clusterID explicitly through call chains

**Specific files requiring updates:**

| File | Function | Issue |
|------|----------|-------|
| `fetch_helpers.go:165,174` | `ensureClientInitialized()`, `ensureAPIExtensionsClientInitialized()` | Check global `app.client` - delete these functions |
| `object_yaml.go:262,271` | `listEndpointSlicesForService()` | Uses global client - delete, use `listEndpointSlicesForServiceWithDependencies()` instead |
| `app_testing.go:43-91` | `SetRestConfig()`, `SetMetricsClient()`, etc. | Set global fields - delete or update to only set per-cluster |
| `kubeconfigs.go:545-549` | `clearKubeconfigSelection()` | Clears global fields - remove those lines |
| `app_refresh_setup.go:302-316` | `startRefreshHTTPServer()` | Writes `refreshManager`, `telemetryRecorder`, informer factories from hostSubsystem |
| `app_object_catalog.go:153-193` | catalog telemetry usage | Falls back to `app.telemetryRecorder` - must use per-cluster telemetry |
| `app_refresh_recovery.go:191-206` | `rebuildRefreshSubsystem()` | Clears global clients - covered in Section 3 |

**Note:** The scope is larger than this table. Run `rg 'a\.client[^s]'`, `rg 'a\.restConfig'`, `rg 'a\.refreshManager'` etc. in `backend/` to find all usages. Many tests and helpers depend on these globals.

---

## Section 2: Heartbeat Per-Cluster

**Current behavior:**
- Single loop checking global `app.client`
- Emits global connection status

**New behavior:**
- Iterate `app.clusterClients` map
- Each cluster gets independent health check via `clients.client.Discovery().RESTClient()`
- Emit `cluster:health:degraded` / `cluster:health:healthy` with `clusterID`
- If a cluster's auth is already invalid (per auth manager), skip its heartbeat check

**Structure:**

```go
func (app *App) runHeartbeat() {
    // For each cluster in app.clusterClients:
    //   - Skip if authManager reports invalid state
    //   - Check health via Discovery endpoint
    //   - Emit cluster-specific health event
    //   - If health check fails repeatedly, report to cluster's authManager
}
```

**IMPORTANT:** The per-cluster heartbeat must NOT call:
- `recordTransportFailure()` - this triggers global recovery
- `updateConnectionStatus()` - this updates global state

Instead, failures should be reported to the cluster's own `authManager.ReportFailure()` which triggers per-cluster recovery via `handleClusterAuthStateChange()`.

Files to review: `app_heartbeat.go:31-56`, `app_refresh_recovery.go:217-255`

---

## Section 3: Delete Global `rebuildRefreshSubsystem`

**Current problem (`app_refresh_recovery.go`):**

```go
// This nukes ALL clusters when rebuilding:
app.client = nil
app.clusterClients = make(map[string]*clusterClients)  // Destroys all!
```

**Fix:**
- Delete `rebuildRefreshSubsystem` entirely
- Per-cluster rebuild already exists: `rebuildClusterSubsystem(clusterID)` in `cluster_auth.go`
- All callers must use per-cluster rebuild
- Any recovery path must specify which cluster to rebuild

**Callers that must be updated:**

| File | Function | Current behavior |
|------|----------|------------------|
| `app_refresh_recovery.go:162-186` | `handleAuthRecovery()` | Calls global rebuild - must use per-cluster |
| `app_refresh_recovery.go:258-284` | `handleTransportRebuild()` | Calls global rebuild - must use per-cluster |

**Interplay with Section 6:** These recovery paths also call `updateConnectionStatus()`. When removing global connection status, ensure these paths use per-cluster auth manager state changes instead.

---

## Section 4: Frontend Pods Filter Fix

**Current problem (`frontend/src/modules/namespace/components/podsFilterSignals.ts`):**

```typescript
// Global key - leaks across clusters
export const PODS_UNHEALTHY_STORAGE_KEY = 'pods:unhealthy-filter-scope';
```

**Fix:**

```typescript
export const getPodsUnhealthyStorageKey = (clusterId: string) =>
    `pods:unhealthy-filter-scope:${clusterId}`;
```

- `NsViewPods.tsx` must pass clusterId when reading/writing this key
- On cluster tab switch, the filter state is naturally isolated

---

## Section 5: Frontend Auth Error Handler (CRITICAL)

**Two problems must be fixed:**

### Problem 1: Event name mismatch

Frontend listens for (`useAuthErrorHandler.ts:73-74`):
```typescript
// WRONG - these events are never emitted!
runtime.EventsOn('auth:failed', handleAuthFailed);
runtime.EventsOn('auth:recovered', handleAuthRecovered);
```

Backend actually emits (`cluster_auth.go:43,55,68`):
```go
runtime.EventsEmit(app.Ctx, "cluster:auth:failed", ...)
runtime.EventsEmit(app.Ctx, "cluster:auth:recovering", ...)
runtime.EventsEmit(app.Ctx, "cluster:auth:recovered", ...)
```

**The frontend never receives auth events.**

### Problem 2: Payload shape mismatch

Backend emits a map (`cluster_auth.go:43-72`):
```go
map[string]any{
    "clusterId":   clusterID,
    "clusterName": clusterName,
    "reason":      reason,
}
```

Frontend expects a string (`useAuthErrorHandler.ts:52`):
```typescript
const reason = typeof args[0] === 'string' ? args[0] : 'Authentication failed';
```

**Even after fixing event names, the handler won't show cluster context.**

### Fix

1. Listen for `cluster:auth:failed`, `cluster:auth:recovering`, `cluster:auth:recovered`
2. Destructure the map payload to extract `clusterId`, `clusterName`, `reason`
3. Track auth errors per cluster using `Map<clusterId, authState>` (not single `hasActiveAuthError` boolean)
4. Show per-cluster auth status in UI (e.g., badge on cluster tab, or inline message in cluster view)
5. Retry should call `RetryClusterAuth(clusterID)` not global `RetryAuth()`

---

## Section 6: Remove Global Auth and Connection Status

**IMPORTANT: Migration order matters.** The frontend currently depends on global `connection-status` events. Removing them without a replacement would break the UI.

**Migration steps (in order):**

1. **First: Wire up per-cluster events in frontend**
   - Update `useAuthErrorHandler.ts` to listen for `cluster:auth:*` events (Section 5)
   - Update `useWailsRuntimeEvents.ts` to handle `cluster:health:*` events
   - Update `RefreshStatusIndicator.tsx` to show status for active cluster only
   - Store per-cluster status in frontend state

2. **Second: Implement per-cluster heartbeat** (Section 2)
   - Emit `cluster:health:*` events from backend
   - Frontend now receives per-cluster health

3. **Third: Remove global backend code**
   - Delete `RetryAuth()` - use `RetryClusterAuth(clusterID)` instead
   - Delete `handleAuthStateChange()` - deprecated, no longer needed
   - Delete `initAuthManager()` - no-op
   - Delete `updateAggregateConnectionStatus()` - no global aggregate
   - Delete `updateConnectionStatus()` - no longer needed
   - Stop emitting `connection-status` event

4. **Fourth: Delete connection status fields from `app.go`:**

```go
connectionStatus          ConnectionState
connectionStatusMessage   string
connectionStatusNextRetry int64
connectionStatusUpdatedAt int64
```

**Files affected by this migration:**
- `backend/app_connection_status.go:37-95` - delete or gut
- `frontend/src/hooks/useWailsRuntimeEvents.ts:71-86` - update to per-cluster
- `backend/cluster_auth.go:75-76` - remove call to `updateAggregateConnectionStatus()`
- `backend/app_refresh_recovery.go:217-226` - remove global status updates

**New model:**
- Each cluster's auth manager already tracks state (`Valid`, `Recovering`, `Invalid`)
- Frontend gets status via `GetClusterAuthState(clusterID)` or listens to `cluster:auth:*` events
- Frontend displays status for active cluster tab only
- No global connection status fields needed in App struct

---

## Section 7: Testing Requirements

**Verification criteria:**

1. **Isolation test**: Cluster A auth fails → Cluster B continues working normally (data loads, tabs responsive)

2. **Heartbeat test**: Health checks run independently per cluster; one cluster timing out doesn't affect others

3. **Recovery test**: Cluster A recovers auth → only Cluster A's subsystem rebuilds; Cluster B untouched

4. **Frontend test**: Switch tabs → connection status shows correct state for active cluster

5. **Pods filter test**: Set filter in Cluster A → switch to Cluster B → filter not applied

6. **Auth event test**: Backend emits `cluster:auth:failed` → frontend receives and displays for correct cluster

7. **Drain store test**: Drain node in Cluster A → drain jobs list for Cluster B is empty

8. **Error event test**: Backend error in Cluster A → frontend error display shows Cluster A identifier

9. **Retry test**: Click retry for Cluster A → only Cluster A retries, Cluster B unaffected

10. **Auth recovery scheduling test**: Permission failure in Cluster A → only Cluster A schedules recovery, Cluster B continues

11. **Fetch retry test**: Fetch fails in Cluster A → global connection status unchanged, only Cluster A shows retry state

12. **Transport failure test**: 3 transport failures in Cluster A → only Cluster A rebuilds, Cluster B untouched

13. **No auto-select test**: Add two clusters → no cluster auto-selected as active, user must choose

14. **Shell event test**: Shell session in Cluster A emits events → events include Cluster A's ID

15. **Mux rebuild test**: Remove Cluster A (host) → HTTP server continues serving Cluster B

16. **Registry permissions test**: Cluster A lacks metrics permission, Cluster B has it → metrics domain available for Cluster B

**Coverage target**: Per AGENTS.md, aim for 80% on changed packages. Key packages:
- `backend/internal/authstate/` (already has tests)
- `backend/` (heartbeat, lifecycle changes)
- Frontend hooks/components touched

---

## Section 8: Global Drain Store Isolation

**Current problem (`nodemaintenance/store.go:73-78`):**

```go
var defaultStore = NewStore(5)

func GlobalStore() *Store {
    return defaultStore
}
```

All drain jobs across all clusters stored in single global store.

**Fix:**
- Add cluster ID to drain job lookups
- Partition the store by cluster ID, or
- Create per-cluster drain stores

**Structure:**

```go
// Option A: Partition within single store
func (s *Store) GetJobsForCluster(clusterID string) []*DrainJob

// Option B: Per-cluster stores (preferred)
type drainStores struct {
    mu     sync.RWMutex
    stores map[string]*Store  // keyed by clusterID
}
```

---

## Section 9: Add ClusterId to Backend Error Events

**Current problem (`fetch_helpers.go:74,114`):**

```go
app.emitEvent("backend-error", map[string]any{
    "resourceKind": resourceKind,
    "identifier":   identifier,
    "message":      message,
    "error":        err.Error(),
})
```

No `clusterId` in payload - frontend can't identify which cluster had the error.

**Fix:**
- Add `clusterId` to all `backend-error` event payloads
- Update frontend `useBackendErrorHandler.ts` to use clusterId for display

---

## Section 10: Per-Cluster Error Capture

**Current problem (`errorcapture/error_capture.go:34-61`):**

```go
var (
    global       *Capture
    eventEmitter func(string)
    logSink      func(level string, message string)
)
```

Single global buffer for all clusters' stderr output.

**Fix:**
- Either prefix captured output with cluster identifier, or
- Create per-cluster capture instances
- Ensure auth errors from different clusters are distinguishable

---

## Section 11: Per-Cluster Retry Flow

**Current problem (`frontend/src/hooks/useAuthErrorHandler.ts:21-35`):**

```typescript
const handleRetry = useCallback(async () => {
    EventsEmit('auth:retry-requested');  // No backend listener for this
    // ...
    await module.RetryAuth();  // Calls GLOBAL retry, not per-cluster
}, []);
```

Frontend retry calls global `RetryAuth()` which retries ALL clusters, and emits an event with no backend listener.

**Fix:**
- Frontend must track which cluster(s) have auth failures
- Retry button must call `RetryClusterAuth(clusterID)` for specific cluster
- Remove `auth:retry-requested` event emission (unused)
- Remove global `RetryAuth()` function from backend (covered in Section 6)

**New frontend retry flow:**
```typescript
const handleRetry = useCallback(async (clusterId: string) => {
    await module.RetryClusterAuth(clusterId);
}, []);
```

---

## Section 12: Node Drain Snapshots Must Include Cluster Context

**Current problem:**

1. `resources/nodes/nodes.go:122-135` - Drain job snapshots don't set `ClusterID` or `ClusterName` fields
2. `refresh/snapshot/node_maintenance.go:13-36` - Snapshot only filters by node name, then stamps current cluster meta

**Cross-cluster data leak:** When node names overlap across clusters (e.g., both have a node named "worker-1"), drains from one cluster can appear in another cluster's view.

**Fix:**
- When creating drain jobs, populate `ClusterID` and `ClusterName` from the cluster context
- Update `nodemaintenance/store.go` drain job creation to require cluster context
- Snapshot must filter by BOTH node name AND cluster ID
- Ensure drain history queries can filter by cluster

**Files:**
- `backend/nodemaintenance/store.go:60-200`
- `backend/resources/nodes/nodes.go:122-135`
- `backend/refresh/snapshot/node_maintenance.go:13-36`

---

## Section 13: Per-Cluster Auth Recovery Scheduling

**Current problem (`app_refresh_recovery.go:131-167`):**

```go
var authRecoveryScheduled bool  // GLOBAL flag
```

A single global `authRecoveryScheduled` flag means one cluster's permission failure can block or trigger recovery for all clusters.

**Also in `refresh/system/manager.go:38-115`:** Permission issues trigger auth recovery without cluster context.

**Fix:**
- Replace global `authRecoveryScheduled` with per-cluster flags: `map[string]bool` keyed by clusterID
- Permission failure handling must include cluster context
- Each cluster's recovery is independent

**Structure:**
```go
type App struct {
    // ...
    authRecoveryScheduled map[string]bool  // keyed by clusterID
    authRecoveryMu        sync.Mutex
}

func (app *App) scheduleAuthRecovery(clusterID string) {
    app.authRecoveryMu.Lock()
    defer app.authRecoveryMu.Unlock()
    if app.authRecoveryScheduled[clusterID] {
        return  // Already scheduled for this cluster
    }
    app.authRecoveryScheduled[clusterID] = true
    go app.runAuthRecovery(clusterID)
}
```

---

## Section 14: `executeWithRetry` Must Not Update Global Status

**Current problem (`fetch_helpers.go:204-258`):**

`executeWithRetry` updates global transport/connection status on every fetch attempt. Even with per-cluster dependencies passed in, this causes cross-cluster status bleed.

**Fix:**
- Remove calls to `updateConnectionStatus()` from `executeWithRetry`
- Remove calls to `recordTransportFailure()` from retry logic
- Failures should be reported to the cluster's auth manager instead
- Connection status is per-cluster, shown for active tab only (Section 6)

**Alternative:** If retry status display is needed, emit per-cluster events:
```go
app.emitEvent("cluster:fetch:retrying", map[string]any{
    "clusterId": clusterID,
    "attempt":   attempt,
    "maxRetries": maxRetries,
})
```

---

## Section 15: Refresh HTTP Server Host Subsystem Handling

**Current problem (`app_refresh_setup.go:71-231`):**

The refresh HTTP server anchors on a single `hostSubsystem` (first valid cluster) for mux/telemetry/registry wiring. This is effectively a "host" cluster even though we've said no "primary" cluster exists.

**Questions to resolve:**
1. What happens if the host subsystem's cluster becomes invalid?
2. Should the mux/registry be shared across all clusters or per-cluster?
3. Can we remove the "host" concept entirely?

**Proposed fix:**
- The HTTP server infrastructure (mux, registry) should be cluster-agnostic
- Telemetry should aggregate from all per-cluster telemetry recorders, not use one cluster's recorder
- If the "first" cluster fails, the HTTP server should continue serving other clusters
- Remove the `hostSubsystem` variable; iterate all subsystems equally

**Files:**
- `backend/app_refresh_setup.go:71-231`

---

## Section 16: Per-Cluster Transport Failure Tracking

**Current problem (`app.go:81-85`, `app_refresh_recovery.go:228-285`):**

```go
// GLOBAL transport failure state - affects ALL clusters
transportMu                sync.Mutex
transportFailureCount      int        // Failures from ANY cluster increment this
transportWindowStart       time.Time  // Single window for all clusters
transportRebuildInProgress bool       // Only one rebuild at a time
lastTransportRebuild       time.Time  // Cooldown blocks ALL clusters
```

**Behavior:**
- 3 transport failures from ANY cluster within 30 seconds triggers global rebuild
- Global rebuild wipes ALL cluster clients (`clusterClients = make(map[string]*clusterClients)`)
- 1-minute cooldown after rebuild blocks ALL clusters from triggering another rebuild
- Cluster B's healthy operation can be destroyed by Cluster A's transport failures

**Fix:**
Replace global tracking with per-cluster tracking:

```go
type transportFailureState struct {
    mu                sync.Mutex
    failureCount      int
    windowStart       time.Time
    rebuildInProgress bool
    lastRebuild       time.Time
}

type App struct {
    // ...
    transportStates map[string]*transportFailureState  // keyed by clusterID
}
```

**Functions to update:**
- `recordTransportFailure(clusterID, reason, err)` - track per-cluster
- `recordTransportSuccess(clusterID)` - reset per-cluster
- `runTransportRebuild(clusterID, reason, err)` - rebuild only affected cluster

---

## Section 17: Remove First Cluster Auto-Selection

**Current problem:**

Backend (`kubeconfigs.go:446`):
```go
// Comment states: "selections matters (the first selection is the 'primary' cluster)."
```

Frontend (`KubeconfigContext.tsx:228,230,257`):
```typescript
// Auto-selects first cluster as active
selectedKubeconfigRef.current = normalizedSelection[0] || '';
setSelectedKubeconfigState(normalizedSelection[0] || '');

// Falls back to first cluster when active is removed
const nextActive = ... removedActive ? normalizedSelections[0] || '' : ...
```

**This violates:** `docs/development/multi-cluster-support.md:46`:
> "Do not auto-select a default kubeconfig or context; activation only happens through explicit user action or persisted selections."

**Fix:**
- Remove comment from `kubeconfigs.go:446` that documents "primary" concept
- Frontend must NOT auto-select first cluster
- When active cluster is removed, require explicit user selection (show cluster picker)
- Only auto-select if there's exactly one cluster (trivial case)
- Persist active cluster selection and restore on reload

---

## Section 18: Add ClusterId to Shell Session Events

**Current problem (`shell_sessions.go:344,355`):**

```go
// Shell output event - no cluster context
app.emitEvent("object-shell:output", ShellOutputEvent{
    SessionID: session.ID,
    Stream:    stream,
    Data:      data,
})

// Shell status event - no cluster context
app.emitEvent("object-shell:status", ShellStatusEvent{
    SessionID: session.ID,
    Status:    status,
    Reason:    reason,
})
```

Shell sessions are initiated with `clusterID` parameter (line 141) but this context is lost in stream events.

**Fix:**
Add `ClusterID` to event payloads:

```go
type ShellOutputEvent struct {
    SessionID string
    ClusterID string  // ADD
    Stream    string
    Data      string
}

type ShellStatusEvent struct {
    SessionID string
    ClusterID string  // ADD
    Status    string
    Reason    string
}
```

Store `clusterID` in `shellSession` struct and include in all emitted events.

---

## Section 19: Refresh Mux Must Handle Cluster Changes

**Current problem:**

1. `app_refresh_setup.go:195-242` - Mux built once with `hostSubsystem`, never rebuilt
2. `app_refresh_update.go:12-100` - Selection updates do NOT rebuild mux
3. `app_refresh_setup.go:199-231` - Registry comes from hostSubsystem

**Issues:**
- `buildRefreshMux()` creates routes anchored to host cluster's handlers
- `mux.Handle("/", hostSubsystem.Handler)` - default route to host
- When clusters are added/removed, mux is NOT updated
- If host cluster becomes invalid, mux still routes to dead handler
- **Registry permission problem:** Domain registration is permission-gated per cluster. If host lacks permissions, entire domains may be missing for ALL clusters, even when other clusters allow them.

**Fix:**
- Mux must be cluster-agnostic or dynamically rebuilt
- Aggregate handlers (`refreshAggregateHandlers`) already exist and route correctly
- Remove direct `hostSubsystem.Handler` default route
- Ensure all routes go through aggregate handlers that iterate all subsystems
- On cluster removal, clean up references in aggregate handlers
- On cluster addition, register with aggregate handlers
- **Registry must merge permissions from all clusters**, not use host's permissions alone

**Files:**
- `backend/app_refresh_setup.go:180-275`
- `backend/app_refresh_update.go:12-100`
- `backend/refresh/system/manager.go:97-120`

**Alternative:** Rebuild mux on cluster selection changes (more disruptive but simpler)

---

## Section 20: updateConnectionStatus Call Sites

**Current problem:** `updateConnectionStatus()` is called from 15+ locations, all updating global state.

| File | Line | Trigger |
|------|------|---------|
| `app_refresh_recovery.go` | 154 | Auth failure |
| `app_refresh_recovery.go` | 186 | Auth recovery |
| `app_refresh_recovery.go` | 225 | Transport success |
| `app_refresh_recovery.go` | 250 | Transport degradation |
| `app_refresh_recovery.go` | 274 | Transport rebuild failed |
| `app_refresh_recovery.go` | 284 | Transport rebuild success |
| `app_heartbeat.go` | 55 | Heartbeat failed |
| `app_kubernetes_client.go` | 9 | Client init failed |
| `app_kubernetes_client.go` | 37 | Client init success |
| `fetch_helpers.go` | 213 | Fetch success after retry |
| `fetch_helpers.go` | 236 | Fetch retry |
| `fetch_helpers.go` | 254 | Fetch final failure |
| `fetch_helpers.go` | 258 | Fetch success |
| `cluster_auth.go` | 238 | Aggregate auth failed |
| `cluster_auth.go` | 240 | Aggregate auth retrying |
| `cluster_auth.go` | 242 | Aggregate auth healthy |

**Fix:**
- Delete `updateConnectionStatus()` function entirely
- Each call site must be updated to use per-cluster auth manager state
- Remove all calls as part of Section 6 migration

---

## Section 21: Registry Must Merge Permissions From All Clusters

**Current problem (`app_refresh_setup.go:199-231`, `refresh/system/manager.go:97-120`):**

The refresh API registry comes from `hostSubsystem`. Domain registration is permission-gated per cluster.

**Issue:** If the host cluster lacks permissions for a domain (e.g., metrics, events), that domain is missing from the registry for ALL clusters - even when other clusters DO have those permissions.

**Example:**
- Cluster A (host): No metrics permission
- Cluster B: Has metrics permission
- Result: Metrics domain missing from registry, Cluster B can't access metrics

**Fix:**
- Registry must be an aggregate of all clusters' permitted domains
- A domain should be registered if ANY cluster has permission for it
- Aggregate handlers already route to the correct cluster based on scope
- When evaluating permissions, check all clusters, not just host

**Structure:**
```go
// Instead of using hostSubsystem.Registry directly:
func buildAggregateRegistry(subsystems map[string]*system.Subsystem) *registry.Registry {
    aggregate := registry.New()
    for _, subsystem := range subsystems {
        for _, domain := range subsystem.Registry.Domains() {
            if !aggregate.Has(domain) {
                aggregate.Register(domain, ...)
            }
        }
    }
    return aggregate
}
```

---

## Summary

| Section | Change |
|---------|--------|
| 1 | Delete global client fields from App struct |
| 2 | Heartbeat iterates all clusters independently |
| 3 | Delete global `rebuildRefreshSubsystem`, use per-cluster only |
| 4 | Pods filter key includes clusterId |
| 5 | Auth error handler listens for cluster-specific events, tracks per-cluster, parses map payload |
| 6 | Delete global auth/connection status functions and fields |
| 7 | Tests verify isolation between clusters |
| 8 | Partition drain store by cluster ID |
| 9 | Add clusterId to backend-error events |
| 10 | Per-cluster error capture or cluster-prefixed output |
| 11 | Frontend retry must call `RetryClusterAuth(clusterID)`, not global |
| 12 | Node drain snapshots must populate ClusterID/ClusterName |
| 13 | Per-cluster `authRecoveryScheduled` flags, not global |
| 14 | `executeWithRetry` must not update global connection status |
| 15 | Remove `hostSubsystem` concept from refresh HTTP server |
| 16 | Per-cluster transport failure tracking (replace global counters/flags) |
| 17 | Remove first cluster auto-selection (explicit user action required) |
| 18 | Add clusterId to shell session events |
| 19 | Refresh mux must handle cluster changes dynamically |
| 20 | Remove all `updateConnectionStatus()` call sites |
| 21 | Registry must merge permissions from all clusters |
