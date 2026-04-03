# Cluster Lifecycle State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-cluster lifecycle state machine to the Go backend that emits events to the frontend, enabling unified cluster readiness tracking for favorites navigation, connectivity status, and future features.

**Architecture:** Backend `cluster_lifecycle.go` owns a thread-safe per-cluster state map with valid transition enforcement. State changes emit Wails events. Frontend `ClusterLifecycleContext` subscribes to events and exposes `getClusterState(clusterId)`. Consumers: `FavoritesContext` gates navigation on `ready`, `ConnectivityStatus` displays per-cluster state.

**Tech Stack:** Go (backend state machine, Wails events), React/TypeScript (context, event subscription).

**Spec:** `docs/superpowers/specs/2026-04-03-cluster-lifecycle-design.md`

---

## File Map

### Backend (Go)
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `backend/cluster_lifecycle.go` | State machine: types, state map, transitions, timer, event emission |
| Create | `backend/cluster_lifecycle_test.go` | Tests for state machine transitions and timer |
| Modify | `backend/app.go` | Add `clusterLifecycle` field to `App` struct |
| Modify | `backend/app_lifecycle.go` | Initialize lifecycle in `Startup`, clean up in shutdown |
| Modify | `backend/cluster_clients.go` | Emit `connecting`/`connected` transitions |
| Modify | `backend/cluster_auth.go` | Emit `auth_failed` transition |
| Modify | `backend/app_kubernetes_client.go` | Emit `loading` after `connected` |
| Modify | `backend/app_refresh_setup.go` | Hook namespace completion callback for `ready` |

### Frontend
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/core/contexts/ClusterLifecycleContext.tsx` | Context: event subscription, state map, hydration |
| Create | `frontend/src/core/contexts/ClusterLifecycleContext.test.tsx` | Tests for lifecycle context |
| Modify | `frontend/src/App.tsx` | Add `ClusterLifecycleProvider` to provider tree |
| Modify | `frontend/src/core/contexts/FavoritesContext.tsx` | Gate navigation on `isClusterReady` |
| Modify | `frontend/src/ui/status/ConnectivityStatus.tsx` | Display per-cluster lifecycle state |
| Modify | `frontend/src/core/events/eventBus.ts` | Add `cluster:lifecycle` event type |
| Modify | `frontend/.storybook/preview.ts` | Add `GetAllClusterLifecycleStates` stub |
| Modify | `frontend/.storybook/decorators/SidebarProvidersDecorator.tsx` | Add `ClusterLifecycleProvider` |

---

## Task 1: Backend State Machine

**Files:**
- Create: `backend/cluster_lifecycle.go`
- Create: `backend/cluster_lifecycle_test.go`
- Modify: `backend/app.go`

- [ ] **Step 1: Write failing tests**

Create `backend/cluster_lifecycle_test.go`:

```go
package backend

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestClusterLifecycleTransitions(t *testing.T) {
	var emitted []map[string]string
	var mu sync.Mutex
	emitter := func(clusterId, state, prev string) {
		mu.Lock()
		emitted = append(emitted, map[string]string{
			"clusterId":     clusterId,
			"state":         state,
			"previousState": prev,
		})
		mu.Unlock()
	}

	lc := newClusterLifecycle(emitter)

	// Initial state is connecting.
	lc.SetState("cluster-1", ClusterStateConnecting)
	require.Equal(t, ClusterStateConnecting, lc.GetState("cluster-1"))

	// Connected.
	lc.SetState("cluster-1", ClusterStateConnected)
	require.Equal(t, ClusterStateConnected, lc.GetState("cluster-1"))

	// Loading.
	lc.SetState("cluster-1", ClusterStateLoading)
	require.Equal(t, ClusterStateLoading, lc.GetState("cluster-1"))

	// Ready.
	lc.SetState("cluster-1", ClusterStateReady)
	require.Equal(t, ClusterStateReady, lc.GetState("cluster-1"))

	// Verify events were emitted.
	mu.Lock()
	require.Len(t, emitted, 4)
	require.Equal(t, "connecting", emitted[0]["state"])
	require.Equal(t, "connected", emitted[1]["state"])
	require.Equal(t, "loading", emitted[2]["state"])
	require.Equal(t, "ready", emitted[3]["state"])
	mu.Unlock()
}

func TestClusterLifecycleSlowLoading(t *testing.T) {
	var emitted []string
	var mu sync.Mutex
	emitter := func(clusterId, state, prev string) {
		mu.Lock()
		emitted = append(emitted, state)
		mu.Unlock()
	}

	lc := newClusterLifecycleWithSlowThreshold(emitter, 50*time.Millisecond)

	lc.SetState("cluster-1", ClusterStateConnecting)
	lc.SetState("cluster-1", ClusterStateConnected)
	lc.SetState("cluster-1", ClusterStateLoading)

	// Wait for the slow timer to fire.
	time.Sleep(100 * time.Millisecond)

	mu.Lock()
	require.Contains(t, emitted, "loading_slow")
	mu.Unlock()
	require.Equal(t, ClusterStateLoadingSlow, lc.GetState("cluster-1"))
}

func TestClusterLifecycleSlowTimerCancelledOnReady(t *testing.T) {
	var emitted []string
	var mu sync.Mutex
	emitter := func(clusterId, state, prev string) {
		mu.Lock()
		emitted = append(emitted, state)
		mu.Unlock()
	}

	lc := newClusterLifecycleWithSlowThreshold(emitter, 100*time.Millisecond)

	lc.SetState("cluster-1", ClusterStateConnecting)
	lc.SetState("cluster-1", ClusterStateConnected)
	lc.SetState("cluster-1", ClusterStateLoading)

	// Transition to ready before the slow timer fires.
	lc.SetState("cluster-1", ClusterStateReady)
	time.Sleep(150 * time.Millisecond)

	mu.Lock()
	require.NotContains(t, emitted, "loading_slow")
	mu.Unlock()
}

func TestClusterLifecycleGetAllStates(t *testing.T) {
	lc := newClusterLifecycle(func(string, string, string) {})

	lc.SetState("cluster-1", ClusterStateReady)
	lc.SetState("cluster-2", ClusterStateLoading)

	states := lc.GetAllStates()
	require.Equal(t, ClusterStateReady, states["cluster-1"])
	require.Equal(t, ClusterStateLoading, states["cluster-2"])
}

func TestClusterLifecycleRemove(t *testing.T) {
	lc := newClusterLifecycle(func(string, string, string) {})

	lc.SetState("cluster-1", ClusterStateReady)
	lc.Remove("cluster-1")

	require.Equal(t, ClusterLifecycleState(""), lc.GetState("cluster-1"))
}

func TestClusterLifecycleUnknownCluster(t *testing.T) {
	lc := newClusterLifecycle(func(string, string, string) {})
	require.Equal(t, ClusterLifecycleState(""), lc.GetState("unknown"))
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test -run TestClusterLifecycle -v`
Expected: Compilation errors — types and functions don't exist yet.

- [ ] **Step 3: Implement the state machine**

Create `backend/cluster_lifecycle.go`:

```go
package backend

import (
	"sync"
	"time"
)

// ClusterLifecycleState represents the lifecycle state of a connected cluster.
type ClusterLifecycleState string

const (
	ClusterStateConnecting   ClusterLifecycleState = "connecting"
	ClusterStateAuthFailed   ClusterLifecycleState = "auth_failed"
	ClusterStateConnected    ClusterLifecycleState = "connected"
	ClusterStateLoading      ClusterLifecycleState = "loading"
	ClusterStateLoadingSlow  ClusterLifecycleState = "loading_slow"
	ClusterStateReady        ClusterLifecycleState = "ready"
	ClusterStateDisconnected ClusterLifecycleState = "disconnected"
	ClusterStateReconnecting ClusterLifecycleState = "reconnecting"
)

const defaultSlowLoadingThreshold = 10 * time.Second

// lifecycleEventEmitter is called on each state transition.
type lifecycleEventEmitter func(clusterId string, state string, previousState string)

type clusterLifecycleEntry struct {
	state     ClusterLifecycleState
	slowTimer *time.Timer
}

// clusterLifecycle tracks per-cluster lifecycle state.
type clusterLifecycle struct {
	mu            sync.Mutex
	clusters      map[string]*clusterLifecycleEntry
	emitter       lifecycleEventEmitter
	slowThreshold time.Duration
}

func newClusterLifecycle(emitter lifecycleEventEmitter) *clusterLifecycle {
	return newClusterLifecycleWithSlowThreshold(emitter, defaultSlowLoadingThreshold)
}

func newClusterLifecycleWithSlowThreshold(emitter lifecycleEventEmitter, threshold time.Duration) *clusterLifecycle {
	return &clusterLifecycle{
		clusters:      make(map[string]*clusterLifecycleEntry),
		emitter:       emitter,
		slowThreshold: threshold,
	}
}

// SetState transitions a cluster to a new lifecycle state.
func (cl *clusterLifecycle) SetState(clusterId string, state ClusterLifecycleState) {
	cl.mu.Lock()
	defer cl.mu.Unlock()

	entry, exists := cl.clusters[clusterId]
	if !exists {
		entry = &clusterLifecycleEntry{}
		cl.clusters[clusterId] = entry
	}

	previousState := entry.state

	// Cancel any pending slow-loading timer on any transition out of loading.
	if entry.slowTimer != nil {
		entry.slowTimer.Stop()
		entry.slowTimer = nil
	}

	entry.state = state

	// Start the slow-loading timer when entering the loading state.
	if state == ClusterStateLoading {
		entry.slowTimer = time.AfterFunc(cl.slowThreshold, func() {
			cl.mu.Lock()
			e, ok := cl.clusters[clusterId]
			if ok && e.state == ClusterStateLoading {
				e.state = ClusterStateLoadingSlow
				e.slowTimer = nil
				cl.mu.Unlock()
				if cl.emitter != nil {
					cl.emitter(clusterId, string(ClusterStateLoadingSlow), string(ClusterStateLoading))
				}
			} else {
				cl.mu.Unlock()
			}
		})
	}

	if cl.emitter != nil {
		cl.emitter(clusterId, string(state), string(previousState))
	}
}

// GetState returns the current lifecycle state for a cluster.
func (cl *clusterLifecycle) GetState(clusterId string) ClusterLifecycleState {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	entry, ok := cl.clusters[clusterId]
	if !ok {
		return ""
	}
	return entry.state
}

// GetAllStates returns a snapshot of all cluster lifecycle states.
func (cl *clusterLifecycle) GetAllStates() map[string]ClusterLifecycleState {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	result := make(map[string]ClusterLifecycleState, len(cl.clusters))
	for id, entry := range cl.clusters {
		result[id] = entry.state
	}
	return result
}

// Remove cleans up a cluster's lifecycle state and cancels any timers.
func (cl *clusterLifecycle) Remove(clusterId string) {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	entry, ok := cl.clusters[clusterId]
	if ok {
		if entry.slowTimer != nil {
			entry.slowTimer.Stop()
		}
		delete(cl.clusters, clusterId)
	}
}
```

- [ ] **Step 4: Add field to App struct**

In `backend/app.go`, add to the `App` struct fields (after `clusterOps`):

```go
	clusterLifecycle *clusterLifecycle
```

- [ ] **Step 5: Add exported RPC method**

In `backend/cluster_lifecycle.go`, add the Wails-exposed method:

```go
// GetAllClusterLifecycleStates returns the current lifecycle state of all open clusters.
// Exposed to the frontend for hydration on mount.
func (a *App) GetAllClusterLifecycleStates() map[string]ClusterLifecycleState {
	if a.clusterLifecycle == nil {
		return nil
	}
	return a.clusterLifecycle.GetAllStates()
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && go test -run TestClusterLifecycle -v`
Expected: All 6 tests PASS.

---

## Task 2: Backend Integration — Wiring Transitions

**Files:**
- Modify: `backend/app_lifecycle.go` — initialize lifecycle in Startup
- Modify: `backend/cluster_clients.go` — emit `connecting`/`connected`
- Modify: `backend/cluster_auth.go` — emit `auth_failed`
- Modify: `backend/app_kubernetes_client.go` — emit `loading`

- [ ] **Step 1: Initialize lifecycle in Startup**

In `backend/app_lifecycle.go`, in the `Startup` method (after `a.eventEmitter` is assigned), initialize the lifecycle:

```go
a.clusterLifecycle = newClusterLifecycle(func(clusterId, state, previousState string) {
	a.emitEvent("cluster:lifecycle", map[string]string{
		"clusterId":     clusterId,
		"state":         state,
		"previousState": previousState,
	})
})
```

- [ ] **Step 2: Emit `connecting` when building cluster clients**

In `backend/cluster_clients.go`, inside `syncClusterClientPoolWithContext`, before the `parallel.ForEach` call that builds clients (around line 112), emit connecting for each new cluster:

```go
for _, task := range tasks {
	if a.clusterLifecycle != nil {
		a.clusterLifecycle.SetState(task.meta.ID, ClusterStateConnecting)
	}
}
```

- [ ] **Step 3: Emit `connected` after successful client build**

In `backend/cluster_clients.go`, after the built clients are added to `a.clusterClients` (around line 147, after the lock), emit connected:

```go
for _, item := range built {
	if a.clusterLifecycle != nil {
		a.clusterLifecycle.SetState(item.id, ClusterStateConnected)
	}
}
```

- [ ] **Step 4: Emit `auth_failed` on auth errors**

In `backend/cluster_auth.go`, where `cluster:auth:failed` is emitted (around line 86), also transition lifecycle:

```go
if a.clusterLifecycle != nil {
	a.clusterLifecycle.SetState(clusterId, ClusterStateAuthFailed)
}
```

- [ ] **Step 5: Emit `loading` after client initialization**

In `backend/app_kubernetes_client.go`, at the end of `initKubernetesClient` (before the success log on line 31), emit loading for all newly connected clusters:

```go
if a.clusterLifecycle != nil {
	for _, sel := range selections {
		meta := a.clusterMetaForSelection(sel)
		if meta.ID != "" {
			state := a.clusterLifecycle.GetState(meta.ID)
			if state == ClusterStateConnected {
				a.clusterLifecycle.SetState(meta.ID, ClusterStateLoading)
			}
		}
	}
}
```

- [ ] **Step 6: Clean up lifecycle on cluster removal**

In `backend/cluster_clients.go`, where removed clusters are cleaned up (around line 157, where `removedClusterIDs` is populated), remove lifecycle entries:

```go
for _, id := range removedClusterIDs {
	if a.clusterLifecycle != nil {
		a.clusterLifecycle.Remove(id)
	}
}
```

- [ ] **Step 7: Run all backend tests**

Run: `cd backend && go test ./... -count=1`
Expected: All tests pass.

---

## Task 3: Backend Integration — Ready Transition

**Files:**
- Modify: `backend/app_refresh_setup.go` or the namespace snapshot handler

The `loading → ready` transition fires when the namespaces domain serves its first successful response for a cluster. The refresh subsystem builds namespace snapshots via `NamespaceBuilder`. We need a callback from the namespace snapshot handler that notifies the lifecycle.

- [ ] **Step 1: Find the namespace snapshot serve path**

Read `backend/app_refresh_setup.go` to find where namespace snapshot handlers are registered and how they serve data. The namespace handler uses `NamespaceBuilder.Build()` which returns a `NamespaceSnapshot`. After a successful build and serve, the lifecycle should transition to ready.

- [ ] **Step 2: Add a namespace-ready callback**

The simplest approach: in the refresh subsystem's namespace handler, after a successful snapshot build for a cluster, call a callback that transitions the lifecycle to ready. Add a field to the App struct or pass a callback through the handler registration:

```go
// In the namespace snapshot handler, after successful build:
if a.clusterLifecycle != nil {
	state := a.clusterLifecycle.GetState(clusterID)
	if state == ClusterStateLoading || state == ClusterStateLoadingSlow {
		a.clusterLifecycle.SetState(clusterID, ClusterStateReady)
	}
}
```

The exact insertion point depends on how the namespace handler is structured — read the file to find where the snapshot is built and served, then add the lifecycle transition after the first successful serve.

- [ ] **Step 3: Run backend tests**

Run: `cd backend && go test ./... -count=1`
Expected: All tests pass.

---

## Task 4: Frontend ClusterLifecycleContext

**Files:**
- Create: `frontend/src/core/contexts/ClusterLifecycleContext.tsx`
- Create: `frontend/src/core/contexts/ClusterLifecycleContext.test.tsx`
- Modify: `frontend/src/core/events/eventBus.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add event type**

In `frontend/src/core/events/eventBus.ts`, add to the `AppEvents` interface:

```typescript
'cluster:lifecycle': { clusterId: string; state: string; previousState: string };
```

- [ ] **Step 2: Write failing tests**

Create `frontend/src/core/contexts/ClusterLifecycleContext.test.tsx` with tests for:
- `useClusterLifecycle()` throws outside provider
- `getClusterState()` returns empty string for unknown cluster
- `isClusterReady()` returns true when state is 'ready'
- Provider hydrates from `GetAllClusterLifecycleStates` on mount

- [ ] **Step 3: Implement ClusterLifecycleContext**

Create `frontend/src/core/contexts/ClusterLifecycleContext.tsx`:

```typescript
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { EventsOn } from '@wailsjs/runtime/runtime';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

export type ClusterLifecycleState =
  | 'connecting'
  | 'auth_failed'
  | 'connected'
  | 'loading'
  | 'loading_slow'
  | 'ready'
  | 'disconnected'
  | 'reconnecting'
  | '';

interface ClusterLifecycleContextType {
  getClusterState: (clusterId: string) => ClusterLifecycleState;
  isClusterReady: (clusterId: string) => boolean;
}

const ClusterLifecycleContext = createContext<ClusterLifecycleContextType | undefined>(undefined);

export const useClusterLifecycle = (): ClusterLifecycleContextType => {
  const context = useContext(ClusterLifecycleContext);
  if (!context) {
    throw new Error('useClusterLifecycle must be used within ClusterLifecycleProvider');
  }
  return context;
};

export const ClusterLifecycleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [states, setStates] = useState<Map<string, ClusterLifecycleState>>(new Map());
  const { selectedClusterIds } = useKubeconfig();

  // Hydrate from backend on mount.
  useEffect(() => {
    const runtimeApp = (window as any)?.go?.backend?.App;
    if (runtimeApp?.GetAllClusterLifecycleStates) {
      runtimeApp.GetAllClusterLifecycleStates().then((result: Record<string, string> | null) => {
        if (result) {
          setStates(new Map(Object.entries(result) as [string, ClusterLifecycleState][]));
        }
      });
    }
  }, []);

  // Subscribe to lifecycle events.
  useEffect(() => {
    const cancel = EventsOn('cluster:lifecycle', (payload: { clusterId: string; state: string }) => {
      if (payload?.clusterId && payload?.state) {
        setStates((prev) => {
          const next = new Map(prev);
          next.set(payload.clusterId, payload.state as ClusterLifecycleState);
          return next;
        });
      }
    });
    return () => { if (typeof cancel === 'function') cancel(); };
  }, []);

  // Clean up entries for removed clusters.
  useEffect(() => {
    setStates((prev) => {
      if (selectedClusterIds.length === 0 && prev.size === 0) return prev;
      const allowed = new Set(selectedClusterIds);
      const next = new Map<string, ClusterLifecycleState>();
      prev.forEach((state, id) => {
        if (allowed.has(id)) next.set(id, state);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [selectedClusterIds]);

  const getClusterState = useCallback(
    (clusterId: string): ClusterLifecycleState => states.get(clusterId) ?? '',
    [states]
  );

  const isClusterReady = useCallback(
    (clusterId: string): boolean => states.get(clusterId) === 'ready',
    [states]
  );

  const value = useMemo(() => ({ getClusterState, isClusterReady }), [getClusterState, isClusterReady]);

  return (
    <ClusterLifecycleContext.Provider value={value}>{children}</ClusterLifecycleContext.Provider>
  );
};
```

- [ ] **Step 4: Wire into App.tsx provider tree**

In `frontend/src/App.tsx`, add `ClusterLifecycleProvider` inside `KubernetesProvider`, before `FavoritesProvider`:

```tsx
<KubernetesProvider>
  <ClusterLifecycleProvider>
    <FavoritesProvider>
      ...
    </FavoritesProvider>
  </ClusterLifecycleProvider>
</KubernetesProvider>
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run src/core/contexts/ClusterLifecycleContext.test.tsx`
Expected: All tests PASS.

---

## Task 5: Favorites Integration

**Files:**
- Modify: `frontend/src/core/contexts/FavoritesContext.tsx`

- [ ] **Step 1: Import and use ClusterLifecycleContext**

Replace the `queueMicrotask` navigation effect with a clean lifecycle gate:

```typescript
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';

// Inside FavoritesProvider:
const { isClusterReady, getClusterState } = useClusterLifecycle();
const { selectedKubeconfig, selectedClusterId } = useKubeconfig();
```

- [ ] **Step 2: Rewrite the navigation effect**

Replace the existing navigation effect (the one with `queueMicrotask`) with:

```typescript
useEffect(() => {
  if (!pendingFavorite) {
    navigationAppliedRef.current = false;
    return;
  }
  if (navigationAppliedRef.current) return;

  // For cluster-specific favorites, wait for the correct cluster to be active and ready.
  const isClusterSpecific = pendingFavorite.clusterSelection !== '';
  if (isClusterSpecific) {
    if (selectedKubeconfig !== pendingFavorite.clusterSelection) return;
    if (!isClusterReady(selectedClusterId)) return;
  } else {
    // Generic favorite: wait for the active cluster to be ready.
    if (selectedClusterId && !isClusterReady(selectedClusterId)) return;
  }

  navigationAppliedRef.current = true;

  // Apply navigation state — the cluster is ready, so views will load data normally.
  if (pendingFavorite.viewType === 'namespace') {
    viewState.setViewType('namespace');
    viewState.setActiveNamespaceTab(pendingFavorite.view as NamespaceViewType);
    if (pendingFavorite.namespace) {
      namespaceCtx.setSelectedNamespace(pendingFavorite.namespace);
      viewState.onNamespaceSelect(pendingFavorite.namespace);
    }
    viewState.setSidebarSelection({
      type: 'namespace',
      value: pendingFavorite.namespace || '',
    });
  } else if (pendingFavorite.viewType === 'cluster') {
    viewState.setViewType('cluster');
    viewState.setActiveClusterView((pendingFavorite.view as ClusterViewType) || null);
    viewState.setSidebarSelection({ type: 'cluster', value: 'cluster' });
  }
}, [pendingFavorite, selectedKubeconfig, selectedClusterId, isClusterReady, viewState, namespaceCtx]);
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS.

---

## Task 6: ConnectivityStatus Integration

**Files:**
- Modify: `frontend/src/ui/status/ConnectivityStatus.tsx`

- [ ] **Step 1: Import lifecycle hook**

```typescript
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
```

- [ ] **Step 2: Use lifecycle state for status and message**

Add inside the component:

```typescript
const { getClusterState } = useClusterLifecycle();
const lifecycleState = selectedClusterId ? getClusterState(selectedClusterId) : '';
```

Update `getStatus()` to incorporate lifecycle state:

```typescript
const getStatus = (): StatusState => {
  if (isPaused) return 'inactive';
  if (lifecycleState === 'auth_failed') return 'unhealthy';
  if (lifecycleState === 'disconnected') return 'unhealthy';
  if (lifecycleState === 'reconnecting') return 'degraded';
  if (lifecycleState === 'connecting' || lifecycleState === 'loading') return 'refreshing';
  if (lifecycleState === 'loading_slow') return 'degraded';
  if (authState.hasError && authState.isRecovering) return 'degraded';
  if (authState.hasError) return 'unhealthy';
  if (health === 'degraded') return 'degraded';
  if (isRefreshing) return 'refreshing';
  return 'healthy';
};
```

Update `getMessage()`:

```typescript
const getMessage = (): string => {
  if (isPaused) return 'Auto-refresh paused';
  if (lifecycleState === 'connecting') return 'Connecting...';
  if (lifecycleState === 'auth_failed') return 'Auth Failed';
  if (lifecycleState === 'connected' || lifecycleState === 'loading') return 'Loading...';
  if (lifecycleState === 'loading_slow') return 'Loading (taking longer than expected)...';
  if (lifecycleState === 'disconnected') return 'Disconnected';
  if (lifecycleState === 'reconnecting') return 'Reconnecting...';
  if (authState.hasError && authState.isRecovering) return 'Retrying authentication...';
  if (authState.hasError) return authState.reason || 'Authentication failed';
  if (health === 'degraded') return 'Reconnecting...';
  if (isRefreshing) return 'Refreshing...';
  return 'Ready';
};
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS.

---

## Task 7: Storybook and Test Infrastructure

**Files:**
- Modify: `frontend/.storybook/preview.ts`
- Modify: `frontend/.storybook/decorators/SidebarProvidersDecorator.tsx`

- [ ] **Step 1: Add Go stub to preview.ts**

```typescript
GetAllClusterLifecycleStates: () => Promise.resolve({}),
```

- [ ] **Step 2: Add ClusterLifecycleProvider to SidebarProvidersDecorator**

```tsx
import { ClusterLifecycleProvider } from '@core/contexts/ClusterLifecycleContext';

// Inside the provider tree, after KubernetesProvider, before FavoritesProvider:
<KubernetesProvider>
  <ClusterLifecycleProvider>
    <FavoritesProvider>
      ...
    </FavoritesProvider>
  </ClusterLifecycleProvider>
</KubernetesProvider>
```

- [ ] **Step 3: Add mock to view test files that need it**

Any test file that fails with "useClusterLifecycle must be used within ClusterLifecycleProvider" needs a mock:

```typescript
vi.mock('@core/contexts/ClusterLifecycleContext', () => ({
  useClusterLifecycle: () => ({
    getClusterState: () => 'ready',
    isClusterReady: () => true,
  }),
  ClusterLifecycleProvider: ({ children }: { children: React.ReactNode }) => children,
}));
```

- [ ] **Step 4: Run full test suite**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS.

---

## Task 8: End-to-End Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && go test ./... -v`
Expected: All tests PASS.

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 3: Run prerelease QC**

Run: `mage qc:prerelease`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

In the running app:
1. Open a cluster — verify ConnectivityStatus shows "Connecting..." → "Loading..." → "Ready"
2. Open a second cluster — verify status updates when switching tabs
3. Save a favorite on the first cluster
4. Close the first cluster tab
5. Click the favorite — verify the cluster opens, status shows loading progression, then navigates to the correct view with filters once "Ready"
6. Disconnect from network — verify status shows "Disconnected"
7. Reconnect — verify status shows "Reconnecting..." → "Ready"
