# Multi-Cluster Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve true multi-cluster isolation where each cluster is independent - auth failures, transport errors, and data in one cluster never affect other clusters.

**Architecture:** Replace all global state (clients, connection status, auth recovery flags, transport failure counters) with per-cluster equivalents. Frontend tracks auth/health per cluster and displays status for active cluster tab only. No "primary" or "host" cluster concept.

**Tech Stack:** Go backend (Wails v2), React/TypeScript frontend, Kubernetes client-go

**Design Document:** `docs/plans/2025-01-30-multi-cluster-isolation-design.md`

---

## Phase Overview

| Phase | Focus | Risk Level | Dependencies |
|-------|-------|------------|--------------|
| 1 | Frontend Foundation | Low | None |
| 2 | Per-Cluster Backend Infrastructure | Medium | None |
| 3 | Event Enrichment | Low | Phase 2 |
| 4 | Heartbeat & Connection Status Migration | High | Phases 1-3 |
| 5 | Recovery Path Fixes | High | Phase 4 |
| 6 | Final Cleanup | Medium | Phase 5 |
| 7 | Testing & Verification | N/A | All phases |

**CRITICAL:** Phases 4 and 5 are the highest-risk phases. Phase 4 replaces the connection status system. Phase 5 removes global recovery paths. Both require careful verification before proceeding.

---

# Phase 1: Frontend Foundation

**Goal:** Fix frontend event handling without breaking anything. All changes are additive - old code still works until Phase 4.

---

## Task 1.1: Pods Filter Key Isolation (Design Section 4)

**Files:**
- Modify: `frontend/src/modules/namespace/components/podsFilterSignals.ts`
- Modify: `frontend/src/modules/namespace/views/NsViewPods.tsx` (and any other consumers)
- Test: `frontend/src/modules/namespace/components/podsFilterSignals.test.ts` (create)

**Step 1: Read current implementation**

Read `frontend/src/modules/namespace/components/podsFilterSignals.ts` to understand the current filter storage.

**Step 2: Write failing test**

```typescript
// podsFilterSignals.test.ts
import { getPodsUnhealthyStorageKey } from './podsFilterSignals';

describe('podsFilterSignals', () => {
  it('generates cluster-specific storage keys', () => {
    const keyA = getPodsUnhealthyStorageKey('cluster-a');
    const keyB = getPodsUnhealthyStorageKey('cluster-b');

    expect(keyA).toBe('pods:unhealthy-filter-scope:cluster-a');
    expect(keyB).toBe('pods:unhealthy-filter-scope:cluster-b');
    expect(keyA).not.toBe(keyB);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- --testPathPattern=podsFilterSignals`
Expected: FAIL - `getPodsUnhealthyStorageKey` is not a function

**Step 4: Implement the fix**

```typescript
// podsFilterSignals.ts
// Change from:
export const PODS_UNHEALTHY_STORAGE_KEY = 'pods:unhealthy-filter-scope';

// To:
export const getPodsUnhealthyStorageKey = (clusterId: string) =>
    `pods:unhealthy-filter-scope:${clusterId}`;

// Keep old constant for backward compatibility during migration:
export const PODS_UNHEALTHY_STORAGE_KEY = 'pods:unhealthy-filter-scope';
```

**Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- --testPathPattern=podsFilterSignals`
Expected: PASS

**Step 6: Update consumers to use new function**

Search for usages of `PODS_UNHEALTHY_STORAGE_KEY` and update to use `getPodsUnhealthyStorageKey(clusterId)`. Pass `clusterId` from context.

**Step 7: Remove backward compatibility constant**

Once all consumers are updated, remove `PODS_UNHEALTHY_STORAGE_KEY`.

**Step 8: Run all frontend tests**

Run: `cd frontend && npm test`
Expected: All tests pass

**Step 9: Commit**

```bash
git add frontend/src/modules/namespace/
git commit -m "feat(frontend): isolate pods filter storage by cluster ID

Pods unhealthy filter now uses cluster-specific storage keys.
Switching clusters no longer leaks filter state.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1.2: Auth Error Handler - Fix Event Names (Design Section 5, Part 1)

**Files:**
- Modify: `frontend/src/hooks/useAuthErrorHandler.ts`
- Test: Manual verification (events come from backend)

**Step 1: Read current implementation**

Read `frontend/src/hooks/useAuthErrorHandler.ts` to understand current event subscriptions.

**Step 2: Update event subscriptions**

```typescript
// Change from:
runtime.EventsOn('auth:failed', handleAuthFailed);
runtime.EventsOn('auth:recovered', handleAuthRecovered);

// To:
runtime.EventsOn('cluster:auth:failed', handleAuthFailed);
runtime.EventsOn('cluster:auth:recovering', handleAuthRecovering);
runtime.EventsOn('cluster:auth:recovered', handleAuthRecovered);
```

**Step 3: Add handler for recovering state**

```typescript
const handleAuthRecovering = useCallback((...args: any[]) => {
    // Handle recovering state - show "Reconnecting..." UI
    console.log('[AuthErrorHandler] Received cluster:auth:recovering', args);
}, []);
```

**Step 4: Update cleanup**

```typescript
return () => {
    runtime.EventsOff('cluster:auth:failed');
    runtime.EventsOff('cluster:auth:recovering');
    runtime.EventsOff('cluster:auth:recovered');
};
```

**Step 5: Commit**

```bash
git add frontend/src/hooks/useAuthErrorHandler.ts
git commit -m "fix(frontend): listen for correct cluster auth event names

Frontend now listens for cluster:auth:* events that backend actually emits,
instead of auth:* events that were never emitted.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1.3: Auth Error Handler - Parse Payload & Track Per-Cluster (Design Section 5, Part 2)

**Files:**
- Modify: `frontend/src/hooks/useAuthErrorHandler.ts`
- Test: `frontend/src/hooks/useAuthErrorHandler.test.ts` (create or update)

**Step 1: Write failing test for payload parsing**

```typescript
describe('useAuthErrorHandler', () => {
  it('parses cluster auth failed payload correctly', () => {
    const payload = {
      clusterId: 'cluster-123',
      clusterName: 'my-cluster',
      reason: 'Token expired'
    };

    // Test that handler extracts these fields
    // (Implementation depends on how the hook exposes state)
  });

  it('tracks auth errors per cluster', () => {
    // Cluster A fails -> only cluster A marked as failed
    // Cluster B should still show healthy
  });
});
```

**Step 2: Implement per-cluster auth state tracking**

```typescript
// Change from single boolean:
const [hasActiveAuthError, setHasActiveAuthError] = useState(false);

// To per-cluster Map:
const [clusterAuthErrors, setClusterAuthErrors] = useState<Map<string, {
    hasError: boolean;
    reason: string;
    clusterName: string;
    isRecovering: boolean;
}>>(new Map());
```

**Step 3: Update handlers to parse payload**

```typescript
const handleAuthFailed = useCallback((...args: any[]) => {
    // Backend sends: { clusterId, clusterName, reason }
    const payload = args[0] as { clusterId: string; clusterName: string; reason: string } | undefined;
    if (!payload?.clusterId) {
        console.warn('[AuthErrorHandler] Received auth:failed without clusterId', args);
        return;
    }

    setClusterAuthErrors(prev => {
        const next = new Map(prev);
        next.set(payload.clusterId, {
            hasError: true,
            reason: payload.reason || 'Authentication failed',
            clusterName: payload.clusterName || payload.clusterId,
            isRecovering: false,
        });
        return next;
    });
}, []);

const handleAuthRecovering = useCallback((...args: any[]) => {
    const payload = args[0] as { clusterId: string; clusterName: string } | undefined;
    if (!payload?.clusterId) return;

    setClusterAuthErrors(prev => {
        const next = new Map(prev);
        const existing = next.get(payload.clusterId);
        if (existing) {
            next.set(payload.clusterId, { ...existing, isRecovering: true });
        }
        return next;
    });
}, []);

const handleAuthRecovered = useCallback((...args: any[]) => {
    const payload = args[0] as { clusterId: string } | undefined;
    if (!payload?.clusterId) return;

    setClusterAuthErrors(prev => {
        const next = new Map(prev);
        next.delete(payload.clusterId);
        return next;
    });
}, []);
```

**Step 4: Export per-cluster state accessor**

```typescript
// Allow components to check auth state for specific cluster
const getClusterAuthState = useCallback((clusterId: string) => {
    return clusterAuthErrors.get(clusterId) || { hasError: false, reason: '', clusterName: '', isRecovering: false };
}, [clusterAuthErrors]);

// For active cluster display
const getActiveClusterAuthState = useCallback(() => {
    if (!activeClusterId) return { hasError: false, reason: '', clusterName: '', isRecovering: false };
    return getClusterAuthState(activeClusterId);
}, [activeClusterId, getClusterAuthState]);
```

**Step 5: Run tests**

Run: `cd frontend && npm test -- --testPathPattern=useAuthErrorHandler`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/hooks/useAuthErrorHandler.ts frontend/src/hooks/useAuthErrorHandler.test.ts
git commit -m "feat(frontend): track auth errors per cluster

- Parse cluster:auth:* event payloads to extract clusterId, clusterName, reason
- Track auth state per cluster using Map instead of single boolean
- Export getClusterAuthState() for per-cluster status queries

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1.4: Frontend Retry Flow (Design Section 11)

**Files:**
- Modify: `frontend/src/hooks/useAuthErrorHandler.ts`
- Test: Verify `RetryClusterAuth` binding exists in `frontend/wailsjs/go/backend/App.js`

**Step 1: Verify backend binding exists**

Read `frontend/wailsjs/go/backend/App.js` and confirm `RetryClusterAuth` is exported.
If not, this task is blocked until backend implements it (Phase 2).

**Step 2: Update retry handler**

```typescript
// Change from:
const handleRetry = useCallback(async () => {
    EventsEmit('auth:retry-requested');  // Remove - no backend listener
    await module.RetryAuth();  // Remove - global retry
}, []);

// To:
const handleRetry = useCallback(async (clusterId: string) => {
    if (!clusterId) {
        console.warn('[AuthErrorHandler] handleRetry called without clusterId');
        return;
    }

    try {
        await module.RetryClusterAuth(clusterId);
    } catch (err) {
        console.error(`[AuthErrorHandler] RetryClusterAuth failed for ${clusterId}:`, err);
    }
}, []);
```

**Step 3: Update UI to pass clusterId**

Wherever the retry button is rendered, pass the specific cluster's ID:

```typescript
// In component using this hook:
<button onClick={() => handleRetry(clusterId)}>
    Retry {clusterName}
</button>
```

**Step 4: Commit**

```bash
git add frontend/src/hooks/useAuthErrorHandler.ts
git commit -m "fix(frontend): retry calls per-cluster RetryClusterAuth

- Remove unused auth:retry-requested event emission
- Call RetryClusterAuth(clusterId) instead of global RetryAuth()
- Retry is now cluster-specific

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

# Phase 2: Per-Cluster Backend Infrastructure

**Goal:** Add per-cluster tracking structures without removing global ones yet. Both can coexist.

---

## Task 2.1: Per-Cluster Transport Failure Tracking (Design Section 16)

**Files:**
- Modify: `backend/app.go` (add new fields)
- Modify: `backend/app_refresh_recovery.go` (add per-cluster functions)
- Test: `backend/app_refresh_recovery_test.go`

**Step 1: Read current implementation**

Read `backend/app.go:81-85` and `backend/app_refresh_recovery.go:228-285` to understand current transport failure tracking.

**Step 2: Write failing test**

```go
// app_refresh_recovery_test.go
func TestPerClusterTransportFailure(t *testing.T) {
    app := &App{}
    app.initTransportStates()

    // Record failures for cluster A
    app.recordClusterTransportFailure("cluster-a", "test failure", nil)
    app.recordClusterTransportFailure("cluster-a", "test failure", nil)

    // Cluster B should be unaffected
    stateA := app.getTransportState("cluster-a")
    stateB := app.getTransportState("cluster-b")

    assert.Equal(t, 2, stateA.failureCount)
    assert.Equal(t, 0, stateB.failureCount)
}
```

**Step 3: Run test to verify it fails**

Run: `cd backend && go test -run TestPerClusterTransportFailure ./...`
Expected: FAIL - methods don't exist

**Step 4: Add per-cluster transport state structure**

```go
// app.go - add new type and field
type transportFailureState struct {
    mu                sync.Mutex
    failureCount      int
    windowStart       time.Time
    rebuildInProgress bool
    lastRebuild       time.Time
}

type App struct {
    // ... existing fields ...

    // Per-cluster transport failure tracking (NEW)
    transportStatesMu sync.RWMutex
    transportStates   map[string]*transportFailureState
}

func (app *App) initTransportStates() {
    app.transportStatesMu.Lock()
    defer app.transportStatesMu.Unlock()
    if app.transportStates == nil {
        app.transportStates = make(map[string]*transportFailureState)
    }
}

func (app *App) getTransportState(clusterID string) *transportFailureState {
    app.transportStatesMu.Lock()
    defer app.transportStatesMu.Unlock()
    if app.transportStates == nil {
        app.transportStates = make(map[string]*transportFailureState)
    }
    if app.transportStates[clusterID] == nil {
        app.transportStates[clusterID] = &transportFailureState{}
    }
    return app.transportStates[clusterID]
}
```

**Step 5: Add per-cluster record/success functions**

```go
// app_refresh_recovery.go - add new functions (don't remove old ones yet)

func (app *App) recordClusterTransportFailure(clusterID, reason string, err error) {
    state := app.getTransportState(clusterID)
    state.mu.Lock()
    defer state.mu.Unlock()

    now := time.Now()
    // Reset window if expired (30 seconds)
    if now.Sub(state.windowStart) > 30*time.Second {
        state.failureCount = 0
        state.windowStart = now
    }

    state.failureCount++

    // Check if threshold reached (3 failures)
    if state.failureCount >= 3 && !state.rebuildInProgress {
        // Trigger per-cluster rebuild
        go app.runClusterTransportRebuild(clusterID, reason, err)
    }
}

func (app *App) recordClusterTransportSuccess(clusterID string) {
    state := app.getTransportState(clusterID)
    state.mu.Lock()
    defer state.mu.Unlock()
    state.failureCount = 0
}

func (app *App) runClusterTransportRebuild(clusterID, reason string, err error) {
    state := app.getTransportState(clusterID)
    state.mu.Lock()

    // Check cooldown (1 minute)
    if time.Since(state.lastRebuild) < time.Minute {
        state.mu.Unlock()
        return
    }

    state.rebuildInProgress = true
    state.mu.Unlock()

    defer func() {
        state.mu.Lock()
        state.rebuildInProgress = false
        state.lastRebuild = time.Now()
        state.mu.Unlock()
    }()

    // Use existing per-cluster rebuild
    app.rebuildClusterSubsystem(clusterID)
}
```

**Step 6: Run test to verify it passes**

Run: `cd backend && go test -run TestPerClusterTransportFailure ./...`
Expected: PASS

**Step 7: Commit**

```bash
git add backend/app.go backend/app_refresh_recovery.go backend/app_refresh_recovery_test.go
git commit -m "feat(backend): add per-cluster transport failure tracking

- Add transportFailureState struct for per-cluster tracking
- Add recordClusterTransportFailure/Success functions
- Add runClusterTransportRebuild for per-cluster recovery
- Old global functions remain for now (removed in Phase 5)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2.2: Per-Cluster Auth Recovery Scheduling (Design Section 13)

**Files:**
- Modify: `backend/app.go`
- Modify: `backend/app_refresh_recovery.go`
- Test: `backend/app_refresh_recovery_test.go`

**Step 1: Write failing test**

```go
func TestPerClusterAuthRecoveryScheduling(t *testing.T) {
    app := &App{}
    app.initAuthRecoveryState()

    // Schedule recovery for cluster A
    scheduled := app.scheduleClusterAuthRecovery("cluster-a")
    assert.True(t, scheduled)

    // Try to schedule again - should return false (already scheduled)
    scheduledAgain := app.scheduleClusterAuthRecovery("cluster-a")
    assert.False(t, scheduledAgain)

    // Cluster B should be schedulable independently
    scheduledB := app.scheduleClusterAuthRecovery("cluster-b")
    assert.True(t, scheduledB)
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test -run TestPerClusterAuthRecoveryScheduling ./...`
Expected: FAIL - method doesn't exist

**Step 3: Add per-cluster auth recovery state**

```go
// app.go - add new fields
type App struct {
    // ... existing fields ...

    // Per-cluster auth recovery scheduling (NEW)
    clusterAuthRecoveryMu        sync.Mutex
    clusterAuthRecoveryScheduled map[string]bool
}

func (app *App) initAuthRecoveryState() {
    app.clusterAuthRecoveryMu.Lock()
    defer app.clusterAuthRecoveryMu.Unlock()
    if app.clusterAuthRecoveryScheduled == nil {
        app.clusterAuthRecoveryScheduled = make(map[string]bool)
    }
}

func (app *App) scheduleClusterAuthRecovery(clusterID string) bool {
    app.clusterAuthRecoveryMu.Lock()
    defer app.clusterAuthRecoveryMu.Unlock()

    if app.clusterAuthRecoveryScheduled == nil {
        app.clusterAuthRecoveryScheduled = make(map[string]bool)
    }

    if app.clusterAuthRecoveryScheduled[clusterID] {
        return false // Already scheduled
    }

    app.clusterAuthRecoveryScheduled[clusterID] = true
    return true
}

func (app *App) clearClusterAuthRecoveryScheduled(clusterID string) {
    app.clusterAuthRecoveryMu.Lock()
    defer app.clusterAuthRecoveryMu.Unlock()
    delete(app.clusterAuthRecoveryScheduled, clusterID)
}
```

**Step 4: Run test to verify it passes**

Run: `cd backend && go test -run TestPerClusterAuthRecoveryScheduling ./...`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app.go backend/app_refresh_recovery.go backend/app_refresh_recovery_test.go
git commit -m "feat(backend): add per-cluster auth recovery scheduling

- Add clusterAuthRecoveryScheduled map keyed by clusterID
- Add scheduleClusterAuthRecovery() that returns false if already scheduled
- Add clearClusterAuthRecoveryScheduled() to reset after recovery completes
- Old global authRecoveryScheduled remains for now

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2.3: Drain Store Cluster Isolation (Design Section 8)

**Files:**
- Modify: `backend/nodemaintenance/store.go`
- Test: `backend/nodemaintenance/store_test.go`

**Step 1: Read current implementation**

Read `backend/nodemaintenance/store.go` to understand the store structure.

**Step 2: Write failing test**

```go
func TestDrainStoreClusterIsolation(t *testing.T) {
    store := NewStore(5)

    // Add drain job for cluster A
    jobA := &DrainJob{
        NodeName:  "worker-1",
        ClusterID: "cluster-a",
        Status:    DrainStatusPending,
    }
    store.AddJob(jobA)

    // Add drain job for cluster B with SAME node name
    jobB := &DrainJob{
        NodeName:  "worker-1",
        ClusterID: "cluster-b",
        Status:    DrainStatusPending,
    }
    store.AddJob(jobB)

    // GetJobsForCluster should return only matching cluster
    jobsA := store.GetJobsForCluster("cluster-a")
    jobsB := store.GetJobsForCluster("cluster-b")

    assert.Len(t, jobsA, 1)
    assert.Len(t, jobsB, 1)
    assert.Equal(t, "cluster-a", jobsA[0].ClusterID)
    assert.Equal(t, "cluster-b", jobsB[0].ClusterID)
}
```

**Step 3: Run test to verify it fails**

Run: `cd backend && go test -run TestDrainStoreClusterIsolation ./nodemaintenance/...`
Expected: FAIL - GetJobsForCluster doesn't exist or doesn't filter by cluster

**Step 4: Add ClusterID field to DrainJob if missing**

Check if `DrainJob` struct has `ClusterID` field. If not:

```go
type DrainJob struct {
    // ... existing fields ...
    ClusterID   string
    ClusterName string
}
```

**Step 5: Add cluster filtering method**

```go
func (s *Store) GetJobsForCluster(clusterID string) []*DrainJob {
    s.mu.RLock()
    defer s.mu.RUnlock()

    var result []*DrainJob
    for _, job := range s.jobs {
        if job.ClusterID == clusterID {
            result = append(result, job)
        }
    }
    return result
}
```

**Step 6: Run test to verify it passes**

Run: `cd backend && go test -run TestDrainStoreClusterIsolation ./nodemaintenance/...`
Expected: PASS

**Step 7: Commit**

```bash
git add backend/nodemaintenance/
git commit -m "feat(backend): add cluster isolation to drain store

- Ensure DrainJob has ClusterID field
- Add GetJobsForCluster() to filter jobs by cluster
- Prevents cross-cluster drain job bleeding when node names overlap

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

# Phase 3: Event Enrichment

**Goal:** Add clusterId to all backend events so frontend can identify which cluster events belong to.

---

## Task 3.1: Add ClusterId to Backend Error Events (Design Section 9)

**Files:**
- Modify: `backend/fetch_helpers.go`
- Search for other `backend-error` emissions

**Step 1: Read current implementation**

Read `backend/fetch_helpers.go` and search for all `backend-error` event emissions:
```bash
rg 'backend-error' backend/
```

**Step 2: Update all backend-error emissions**

For each location emitting `backend-error`, add `clusterId` to the payload:

```go
// Change from:
app.emitEvent("backend-error", map[string]any{
    "resourceKind": resourceKind,
    "identifier":   identifier,
    "message":      message,
    "error":        err.Error(),
})

// To:
app.emitEvent("backend-error", map[string]any{
    "clusterId":    clusterID,
    "resourceKind": resourceKind,
    "identifier":   identifier,
    "message":      message,
    "error":        err.Error(),
})
```

**Note:** If the function doesn't have access to `clusterID`, it must be passed down from callers or derived from context.

**Step 3: Commit**

```bash
git add backend/fetch_helpers.go backend/*.go
git commit -m "feat(backend): add clusterId to backend-error events

Frontend can now identify which cluster generated each error.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3.2: Add ClusterId to Shell Session Events (Design Section 18)

**Files:**
- Modify: `backend/shell_sessions.go`

**Step 1: Read current implementation**

Read `backend/shell_sessions.go` to understand shell session structure and event emission.

**Step 2: Add ClusterID to session struct**

```go
type shellSession struct {
    // ... existing fields ...
    ClusterID string  // ADD if not present
}
```

**Step 3: Update ShellOutputEvent and ShellStatusEvent**

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

**Step 4: Update event emissions to include ClusterID**

```go
// Where events are emitted:
app.emitEvent("object-shell:output", ShellOutputEvent{
    SessionID: session.ID,
    ClusterID: session.ClusterID,  // ADD
    Stream:    stream,
    Data:      data,
})
```

**Step 5: Commit**

```bash
git add backend/shell_sessions.go
git commit -m "feat(backend): add ClusterID to shell session events

Shell output and status events now include the cluster ID for
proper frontend routing.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3.3: Node Drain Snapshots Cluster Context (Design Section 12)

**Files:**
- Modify: `backend/resources/nodes/nodes.go`
- Modify: `backend/refresh/snapshot/node_maintenance.go`

**Step 1: Read current implementation**

Read the files to understand how drain jobs are created and snapshotted.

**Step 2: Update drain job creation to include cluster context**

In `nodes.go`, where drain jobs are created, ensure ClusterID and ClusterName are populated from the cluster context available in the resource handler.

**Step 3: Update snapshot filtering**

In `node_maintenance.go`, update the snapshot to filter by BOTH node name AND cluster ID:

```go
// Change from filtering by node name only:
func filterDrainJobs(jobs []*nodemaintenance.DrainJob, nodeName string) []*DrainJobSnapshot {
    // ...
}

// To filtering by node name AND cluster:
func filterDrainJobs(jobs []*nodemaintenance.DrainJob, nodeName, clusterID string) []*DrainJobSnapshot {
    var result []*DrainJobSnapshot
    for _, job := range jobs {
        if job.NodeName == nodeName && job.ClusterID == clusterID {
            result = append(result, toSnapshot(job))
        }
    }
    return result
}
```

**Step 4: Commit**

```bash
git add backend/resources/nodes/ backend/refresh/snapshot/
git commit -m "fix(backend): drain snapshots filter by cluster ID

- Drain job creation now includes ClusterID and ClusterName
- Snapshot filtering uses both node name AND cluster ID
- Prevents cross-cluster drain job bleeding when node names overlap

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3.4: Per-Cluster Error Capture (Design Section 10)

**Files:**
- Modify: `backend/internal/errorcapture/error_capture.go`

**Step 1: Read current implementation**

Read `backend/internal/errorcapture/error_capture.go` to understand the global capture.

**Step 2: Choose approach**

**Option A (simpler):** Prefix captured output with cluster identifier
**Option B (cleaner):** Per-cluster capture instances

For this plan, use Option A as it's less disruptive:

```go
// Add cluster context to captured messages
func CaptureWithCluster(clusterID string, message string) {
    prefixed := fmt.Sprintf("[%s] %s", clusterID, message)
    Capture(prefixed)
}
```

**Step 3: Update callers to use cluster-aware capture**

Search for all `errorcapture.Capture` calls and update to use `CaptureWithCluster` where cluster context is available.

**Step 4: Commit**

```bash
git add backend/internal/errorcapture/
git commit -m "feat(backend): prefix error captures with cluster ID

Captured stderr output now includes cluster identifier for
distinguishing errors from different clusters.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

# Phase 4: Heartbeat & Connection Status Migration

**Goal:** This is the critical phase. We replace global connection status with per-cluster health tracking.

**IMPORTANT:** Follow the migration order exactly. Wire up frontend FIRST, then remove backend globals.

---

## Task 4.1: Per-Cluster Heartbeat Implementation (Design Section 2)

**Files:**
- Modify: `backend/app_heartbeat.go`
- Test: `backend/app_heartbeat_test.go`

**Step 1: Read current implementation**

Read `backend/app_heartbeat.go` to understand the current single-cluster heartbeat loop.

**Step 2: Write failing test**

```go
func TestPerClusterHeartbeat(t *testing.T) {
    // Setup app with two clusters
    app := &App{
        clusterClients: map[string]*clusterClients{
            "cluster-a": mockClusterClient("a", true),   // healthy
            "cluster-b": mockClusterClient("b", false),  // unhealthy
        },
    }

    events := []string{}
    app.emitEvent = func(name string, data any) {
        events = append(events, name)
    }

    // Run one heartbeat iteration
    app.runHeartbeatIteration()

    // Should emit health events for both clusters independently
    assert.Contains(t, events, "cluster:health:healthy")
    assert.Contains(t, events, "cluster:health:degraded")
}
```

**Step 3: Run test to verify it fails**

Run: `cd backend && go test -run TestPerClusterHeartbeat ./...`
Expected: FAIL

**Step 4: Implement per-cluster heartbeat**

```go
func (app *App) runHeartbeat() {
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-app.Ctx.Done():
            return
        case <-ticker.C:
            app.runHeartbeatIteration()
        }
    }
}

func (app *App) runHeartbeatIteration() {
    app.clusterClientsMu.RLock()
    clients := make(map[string]*clusterClients, len(app.clusterClients))
    for k, v := range app.clusterClients {
        clients[k] = v
    }
    app.clusterClientsMu.RUnlock()

    for clusterID, cc := range clients {
        // Skip if auth is already invalid
        if cc.authManager != nil && !cc.authManager.IsValid() {
            continue
        }

        // Check health
        healthy := app.checkClusterHealth(cc)

        // Emit cluster-specific event
        eventData := map[string]any{
            "clusterId":   clusterID,
            "clusterName": cc.meta.Name,
        }

        if healthy {
            runtime.EventsEmit(app.Ctx, "cluster:health:healthy", eventData)
        } else {
            runtime.EventsEmit(app.Ctx, "cluster:health:degraded", eventData)
            // Report to cluster's auth manager, NOT global transport failure
            if cc.authManager != nil {
                cc.authManager.ReportFailure("heartbeat check failed")
            }
        }
    }
}

func (app *App) checkClusterHealth(cc *clusterClients) bool {
    if cc.client == nil {
        return false
    }

    // Quick health check via discovery
    ctx, cancel := context.WithTimeout(app.Ctx, 5*time.Second)
    defer cancel()

    _, err := cc.client.Discovery().RESTClient().Get().AbsPath("/healthz").DoRaw(ctx)
    return err == nil
}
```

**Step 5: Run test to verify it passes**

Run: `cd backend && go test -run TestPerClusterHeartbeat ./...`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/app_heartbeat.go backend/app_heartbeat_test.go
git commit -m "feat(backend): implement per-cluster heartbeat

- Heartbeat iterates all clusters independently
- Emits cluster:health:healthy and cluster:health:degraded events
- Reports failures to cluster's auth manager, not global state
- Skips clusters with already-invalid auth

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4.2: Frontend Health Event Handling

**Files:**
- Modify: `frontend/src/hooks/useWailsRuntimeEvents.ts`

**Step 1: Read current implementation**

Read `frontend/src/hooks/useWailsRuntimeEvents.ts` to understand current event handling.

**Step 2: Add cluster health event handlers**

```typescript
// Add state for per-cluster health
const [clusterHealth, setClusterHealth] = useState<Map<string, 'healthy' | 'degraded'>>(new Map());

// Subscribe to cluster health events
useEffect(() => {
    const handleHealthy = (...args: any[]) => {
        const payload = args[0] as { clusterId: string } | undefined;
        if (payload?.clusterId) {
            setClusterHealth(prev => {
                const next = new Map(prev);
                next.set(payload.clusterId, 'healthy');
                return next;
            });
        }
    };

    const handleDegraded = (...args: any[]) => {
        const payload = args[0] as { clusterId: string } | undefined;
        if (payload?.clusterId) {
            setClusterHealth(prev => {
                const next = new Map(prev);
                next.set(payload.clusterId, 'degraded');
                return next;
            });
        }
    };

    runtime.EventsOn('cluster:health:healthy', handleHealthy);
    runtime.EventsOn('cluster:health:degraded', handleDegraded);

    return () => {
        runtime.EventsOff('cluster:health:healthy');
        runtime.EventsOff('cluster:health:degraded');
    };
}, []);
```

**Step 3: Export accessor for active cluster health**

```typescript
const getActiveClusterHealth = useCallback(() => {
    if (!activeClusterId) return 'unknown';
    return clusterHealth.get(activeClusterId) || 'unknown';
}, [activeClusterId, clusterHealth]);
```

**Step 4: Commit**

```bash
git add frontend/src/hooks/useWailsRuntimeEvents.ts
git commit -m "feat(frontend): handle per-cluster health events

- Subscribe to cluster:health:healthy and cluster:health:degraded
- Track health state per cluster in Map
- Export getActiveClusterHealth() for UI

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4.3: Update Status Indicator for Active Cluster Only

**Files:**
- Modify: `frontend/src/components/RefreshStatusIndicator.tsx` (or similar)

**Step 1: Read current implementation**

Find the component that displays connection status and read it.

**Step 2: Update to show active cluster status only**

```typescript
// Instead of using global connection status:
const status = useConnectionStatus();  // OLD: global

// Use per-cluster status:
const { getActiveClusterHealth } = useWailsRuntimeEvents();
const { getActiveClusterAuthState } = useAuthErrorHandler();

const activeHealth = getActiveClusterHealth();
const activeAuth = getActiveClusterAuthState();

// Determine display status
const displayStatus = useMemo(() => {
    if (activeAuth.hasError) {
        return activeAuth.isRecovering ? 'recovering' : 'error';
    }
    return activeHealth === 'degraded' ? 'degraded' : 'healthy';
}, [activeHealth, activeAuth]);
```

**Step 3: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): status indicator shows active cluster only

Connection status now displays health/auth state for the currently
active cluster tab, not a global aggregate.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4.4: Remove Global Connection Status from Backend (Design Section 6)

**CRITICAL:** Only do this AFTER Tasks 4.1-4.3 are complete and verified.

**Files:**
- Modify: `backend/app.go` (remove fields)
- Modify: `backend/app_connection_status.go` (delete or gut)
- Modify: `backend/cluster_auth.go` (remove updateAggregateConnectionStatus call)

**Step 1: Verify frontend is using per-cluster events**

Manually test that the frontend correctly displays per-cluster status before removing backend globals.

**Step 2: Remove connection status fields from App struct**

```go
// DELETE from app.go:
connectionStatus          ConnectionState  // DELETE
connectionStatusMessage   string           // DELETE
connectionStatusNextRetry int64            // DELETE
connectionStatusUpdatedAt int64            // DELETE
```

**Step 3: Delete or gut app_connection_status.go**

Either delete the file entirely or remove the functions:
- `updateConnectionStatus()`
- `updateAggregateConnectionStatus()`
- `GetConnectionStatus()` - or update to return per-cluster status

**Step 4: Remove updateAggregateConnectionStatus call from cluster_auth.go**

```go
// In cluster_auth.go, remove:
app.updateAggregateConnectionStatus()
```

**Step 5: Delete RetryAuth() and other global functions**

```go
// DELETE these functions:
func (app *App) RetryAuth() error
func (app *App) handleAuthStateChange(state authstate.State)
func (app *App) initAuthManager()
```

**Step 6: Update any remaining callers**

Search for any code still calling removed functions and update or remove.

**Step 7: Run all tests**

Run: `cd backend && go test ./...`
Expected: PASS (after fixing any broken references)

**Step 8: Commit**

```bash
git add backend/
git commit -m "feat(backend): remove global connection status

BREAKING: Global connection status removed. Frontend uses per-cluster
health and auth events instead.

- Delete connectionStatus fields from App struct
- Delete updateConnectionStatus(), updateAggregateConnectionStatus()
- Delete global RetryAuth(), use RetryClusterAuth() instead
- Remove call to updateAggregateConnectionStatus from cluster_auth.go

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4.5: Remove updateConnectionStatus Call Sites (Design Section 20)

**Files:**
- Multiple files (see Design Section 20 for full list)

**Step 1: Search for all call sites**

```bash
rg 'updateConnectionStatus' backend/
```

**Step 2: Remove or replace each call**

For each location:
- If in recovery path: use per-cluster auth manager state change
- If in heartbeat: already removed in Task 4.1
- If in fetch helpers: use per-cluster transport failure tracking

**Step 3: Verify no calls remain**

```bash
rg 'updateConnectionStatus' backend/
```
Expected: No results

**Step 4: Commit**

```bash
git add backend/
git commit -m "fix(backend): remove all updateConnectionStatus call sites

All 15+ call sites updated to use per-cluster mechanisms instead.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4.6: executeWithRetry Uses Per-Cluster Tracking (Design Section 14)

**Files:**
- Modify: `backend/fetch_helpers.go`

**Step 1: Read current implementation**

Read `backend/fetch_helpers.go:204-258` to understand executeWithRetry.

**Step 2: Update to use per-cluster tracking**

```go
// Remove calls to:
// - updateConnectionStatus()
// - recordTransportFailure()

// Replace with:
// - app.recordClusterTransportFailure(clusterID, reason, err)
// - app.recordClusterTransportSuccess(clusterID)

// If retry status display is needed, emit per-cluster event:
app.emitEvent("cluster:fetch:retrying", map[string]any{
    "clusterId":   clusterID,
    "attempt":     attempt,
    "maxRetries":  maxRetries,
})
```

**Step 3: Commit**

```bash
git add backend/fetch_helpers.go
git commit -m "fix(backend): executeWithRetry uses per-cluster tracking

- Remove global updateConnectionStatus() calls
- Replace recordTransportFailure with recordClusterTransportFailure
- Emit cluster:fetch:retrying for per-cluster retry UI

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

# Phase 5: Recovery Path Fixes

**Goal:** Remove global recovery mechanisms that destroy all clusters.

---

## Task 5.1: Delete Global rebuildRefreshSubsystem (Design Section 3)

**Files:**
- Modify: `backend/app_refresh_recovery.go`

**Step 1: Find all callers of rebuildRefreshSubsystem**

```bash
rg 'rebuildRefreshSubsystem' backend/
```

**Step 2: Update callers to use per-cluster rebuild**

For `handleAuthRecovery()`:
```go
// Change from:
app.rebuildRefreshSubsystem()

// To:
app.rebuildClusterSubsystem(clusterID)  // Must have clusterID in scope
```

For `handleTransportRebuild()`:
```go
// This should now call runClusterTransportRebuild which uses per-cluster rebuild
```

**Step 3: Delete rebuildRefreshSubsystem function**

```go
// DELETE this entire function:
func (app *App) rebuildRefreshSubsystem() {
    // ... all of it
}
```

**Step 4: Verify no callers remain**

```bash
rg 'rebuildRefreshSubsystem' backend/
```
Expected: No results (except possibly comments)

**Step 5: Run tests**

Run: `cd backend && go test ./...`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/app_refresh_recovery.go
git commit -m "fix(backend): delete global rebuildRefreshSubsystem

BREAKING: Global rebuild removed. Only per-cluster rebuild exists now.
Recovery paths use rebuildClusterSubsystem(clusterID) instead.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5.2: Remove hostSubsystem Concept (Design Sections 15, 19, 21)

**Files:**
- Modify: `backend/app_refresh_setup.go`
- Modify: `backend/app_refresh_update.go`

**Step 1: Read current implementation**

Read the files to understand how hostSubsystem is used.

**Step 2: Replace hostSubsystem with aggregate approach**

The HTTP server infrastructure should:
- Build mux that routes through aggregate handlers
- Use aggregate registry that merges permissions from all clusters
- Not depend on any single "host" cluster

**Step 3: Implement aggregate registry**

```go
func (app *App) buildAggregateRegistry() *registry.Registry {
    app.refreshSubsystemsMu.RLock()
    defer app.refreshSubsystemsMu.RUnlock()

    aggregate := registry.New()
    for _, subsystem := range app.refreshSubsystems {
        for _, domain := range subsystem.Registry.Domains() {
            if !aggregate.Has(domain) {
                // Register domain - available if ANY cluster has permission
                aggregate.Register(domain, subsystem.Registry.Handler(domain))
            }
        }
    }
    return aggregate
}
```

**Step 4: Update mux building**

Remove direct hostSubsystem.Handler routes. All routes should go through aggregate handlers.

**Step 5: Handle cluster removal**

When a cluster is removed, clean up its contribution to aggregates. The mux should continue serving remaining clusters.

**Step 6: Run tests**

Run: `cd backend && go test ./...`
Expected: PASS

**Step 7: Commit**

```bash
git add backend/app_refresh_setup.go backend/app_refresh_update.go
git commit -m "fix(backend): remove hostSubsystem, use aggregate approach

- HTTP server no longer depends on a single 'host' cluster
- Registry merges permissions from ALL clusters
- Mux routes through aggregate handlers
- Removing one cluster doesn't break others

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

# Phase 6: Final Cleanup

**Goal:** Remove remaining legacy code and fix auto-selection.

---

## Task 6.1: Remove First Cluster Auto-Selection (Design Section 17)

**Files:**
- Modify: `backend/kubeconfigs.go`
- Modify: `frontend/src/contexts/KubeconfigContext.tsx`

**Step 1: Remove "primary cluster" comment from backend**

In `kubeconfigs.go:446`, remove or update the comment about "primary" cluster.

**Step 2: Update frontend auto-selection logic**

```typescript
// Change from auto-selecting first:
selectedKubeconfigRef.current = normalizedSelection[0] || '';

// To requiring explicit selection:
// - Only auto-select if exactly ONE cluster (trivial case)
// - Otherwise, show cluster picker / require user action
if (normalizedSelection.length === 1) {
    selectedKubeconfigRef.current = normalizedSelection[0];
} else {
    selectedKubeconfigRef.current = ''; // No auto-select
}
```

**Step 3: Handle active cluster removal**

```typescript
// When active cluster is removed:
// - If only one cluster remains, select it
// - Otherwise, show picker / require explicit selection
const handleActiveClusterRemoved = () => {
    const remaining = normalizedSelections.filter(s => s !== removedActive);
    if (remaining.length === 1) {
        setSelectedKubeconfigState(remaining[0]);
    } else {
        setSelectedKubeconfigState(''); // Require user selection
    }
};
```

**Step 4: Commit**

```bash
git add backend/kubeconfigs.go frontend/src/contexts/KubeconfigContext.tsx
git commit -m "fix: remove first cluster auto-selection

Per multi-cluster support docs: 'Do not auto-select a default kubeconfig
or context; activation only happens through explicit user action.'

- Remove 'primary cluster' concept from backend comments
- Only auto-select when exactly one cluster
- Otherwise require explicit user selection

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6.2: Delete Global Client Fields (Design Section 1)

**Files:**
- Modify: `backend/app.go`
- Modify: Multiple files that reference global fields

**Step 1: Delete global fields from App struct**

```go
// DELETE from app.go:
client               kubernetes.Interface          // DELETE
apiextensionsClient  apiextensionsclientset.Interface  // DELETE
dynamicClient        dynamic.Interface             // DELETE
metricsClient        *metricsclient.Clientset      // DELETE
restConfig           *rest.Config                  // DELETE

sharedInformerFactory        informers.SharedInformerFactory      // DELETE
apiExtensionsInformerFactory apiextinformers.SharedInformerFactory // DELETE

refreshManager    *refresh.Manager      // DELETE
telemetryRecorder *telemetry.Recorder   // DELETE
```

**Step 2: Delete helper functions that use global clients**

```go
// DELETE:
func (app *App) ensureClientInitialized() error
func (app *App) ensureAPIExtensionsClientInitialized() error
func (app *App) listEndpointSlicesForService(...) // The App method, not the Manager method
```

**Step 3: Delete test helper functions**

```go
// DELETE from app_testing.go:
func (app *App) SetRestConfig(...)
func (app *App) SetMetricsClient(...)
// etc.
```

**Step 4: Update any remaining references**

Run grep to find all remaining references and update:
```bash
rg 'app\.client[^s]' backend/
rg 'app\.restConfig' backend/
rg 'app\.refreshManager' backend/
rg 'app\.telemetryRecorder' backend/
```

**Step 5: Run tests**

Run: `cd backend && go test ./...`
Expected: PASS

**Step 6: Commit**

```bash
git add backend/
git commit -m "fix(backend): delete global client fields

BREAKING: Global client fields removed from App struct.
All code must use per-cluster clients via clusterClientsForID().

Fields removed:
- client, apiextensionsClient, dynamicClient, metricsClient, restConfig
- sharedInformerFactory, apiExtensionsInformerFactory
- refreshManager, telemetryRecorder

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6.3: Delete Global Transport/Auth Fields

**Files:**
- Modify: `backend/app.go`

**Step 1: Delete global transport failure fields**

```go
// DELETE from app.go (now replaced by per-cluster transportStates):
transportMu                sync.Mutex      // DELETE
transportFailureCount      int             // DELETE
transportWindowStart       time.Time       // DELETE
transportRebuildInProgress bool            // DELETE
lastTransportRebuild       time.Time       // DELETE
```

**Step 2: Delete global auth recovery field**

```go
// DELETE from app.go (now replaced by per-cluster clusterAuthRecoveryScheduled):
authRecoveryMu        sync.Mutex  // DELETE
authRecoveryScheduled bool        // DELETE
```

**Step 3: Delete global transport failure functions**

```go
// DELETE:
func (app *App) recordTransportFailure(...)
func (app *App) recordTransportSuccess()
func (app *App) runTransportRebuild(...)
```

**Step 4: Run tests**

Run: `cd backend && go test ./...`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/app.go backend/app_refresh_recovery.go
git commit -m "fix(backend): delete global transport/auth tracking fields

BREAKING: Global transport failure tracking removed.
Use per-cluster transportStates map instead.

BREAKING: Global authRecoveryScheduled removed.
Use per-cluster clusterAuthRecoveryScheduled map instead.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

# Phase 7: Testing & Verification

**Goal:** Verify all isolation requirements are met per Design Section 7.

---

## Task 7.1: Write Isolation Integration Tests

**Files:**
- Create: `backend/multi_cluster_isolation_test.go`

**Tests to implement (from Design Section 7):**

```go
func TestIsolation_AuthFailureDoesNotAffectOtherClusters(t *testing.T) {
    // Cluster A auth fails → Cluster B continues working normally
}

func TestIsolation_HeartbeatRunsIndependently(t *testing.T) {
    // Health checks run independently per cluster
}

func TestIsolation_RecoveryOnlyAffectsOneCluster(t *testing.T) {
    // Cluster A recovers auth → only Cluster A rebuilds
}

func TestIsolation_TransportFailureOnlyAffectsOneCluster(t *testing.T) {
    // 3 transport failures in Cluster A → only Cluster A rebuilds
}

func TestIsolation_AuthRecoveryScheduledPerCluster(t *testing.T) {
    // Permission failure in Cluster A → only Cluster A schedules recovery
}

func TestIsolation_DrainStoreByCluster(t *testing.T) {
    // Drain node in Cluster A → drain jobs list for Cluster B is empty
}

func TestIsolation_NoAutoSelectFirstCluster(t *testing.T) {
    // Add two clusters → no cluster auto-selected as active
}
```

**Run all tests:**

```bash
cd backend && go test -v -run TestIsolation ./...
```

---

## Task 7.2: Write Frontend Isolation Tests

**Files:**
- Create: `frontend/src/hooks/multiClusterIsolation.test.ts`

**Tests to implement:**

```typescript
describe('Multi-Cluster Isolation', () => {
    it('pods filter is isolated per cluster', () => {
        // Set filter in Cluster A → switch to Cluster B → filter not applied
    });

    it('auth error is tracked per cluster', () => {
        // Cluster A auth fails → only Cluster A shows error
    });

    it('connection status shows active cluster only', () => {
        // Switch tabs → status shows correct state for active cluster
    });

    it('retry only affects specified cluster', () => {
        // Click retry for Cluster A → only Cluster A retries
    });
});
```

**Run frontend tests:**

```bash
cd frontend && npm test -- --testPathPattern=multiClusterIsolation
```

---

## Task 7.3: Manual Verification Checklist

Before considering the refactor complete, manually verify:

- [ ] Start app with two clusters
- [ ] Verify no cluster auto-selected (must explicitly choose)
- [ ] Invalidate auth for Cluster A (e.g., revoke token)
- [ ] Verify Cluster B still loads data normally
- [ ] Verify Cluster A shows auth error
- [ ] Verify tabs remain responsive
- [ ] Click retry for Cluster A
- [ ] Verify only Cluster A attempts retry
- [ ] Verify Cluster B is unaffected during retry
- [ ] Switch between cluster tabs
- [ ] Verify status indicator changes per tab
- [ ] Set pods filter in Cluster A
- [ ] Switch to Cluster B
- [ ] Verify filter not applied in Cluster B
- [ ] Start node drain in Cluster A
- [ ] Verify drain not visible in Cluster B
- [ ] Remove Cluster A
- [ ] Verify Cluster B continues working
- [ ] Verify HTTP server continues serving

---

## Summary

| Phase | Tasks | Risk |
|-------|-------|------|
| 1 | 1.1-1.4 Frontend foundation | Low |
| 2 | 2.1-2.3 Per-cluster backend infrastructure | Medium |
| 3 | 3.1-3.4 Event enrichment | Low |
| 4 | 4.1-4.6 Heartbeat & connection status migration | **High** |
| 5 | 5.1-5.2 Recovery path fixes | **High** |
| 6 | 6.1-6.3 Final cleanup | Medium |
| 7 | 7.1-7.3 Testing & verification | N/A |

**Total estimated tasks:** 19 implementation tasks + 3 testing tasks = 22 tasks

**Critical checkpoints:**
- After Phase 4: Verify connection status migration works before proceeding
- After Phase 5: Verify recovery paths work before deleting global fields
- After Phase 6: Full regression testing required
