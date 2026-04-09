# Per-Cluster Panel State — Design

**Status:** Design (pending implementation plan)
**Date:** 2026-04-08

## Goal

Make all dockable panel layout state per-cluster: which panels are open, where they are docked, what tab group they belong to, what floating group they sit in, and the per-panel position/size data. State persists for the lifetime of an open cluster tab and is cleared only when the user closes the cluster tab or quits the app. This applies uniformly to ObjectPanels, DiagnosticsPanel, AppLogsPanel, and any future dockable panel — there are no app-global exceptions.

## Why

Today, `ObjectPanelStateContext.objectPanelStateByCluster` stores per-cluster `openPanels` (which object refs are open). It correctly clears its slice when a cluster tab closes. But the layout side of panel state — `DockablePanelProvider.tabGroups` and `panelLayoutStore` — has no concept of clusters at all. They're app-global singletons. This mismatch is currently papered over by a fragile `useEffect` cleanup at `frontend/src/ui/dockable/DockablePanel.tsx:321-325` that calls `removePanelFromGroups(panelId)` whenever a panel unmounts. Cluster switches unmount the previous cluster's panels (because their content depends on the old cluster's data), so the cleanup runs and tears up the tab-group memberships of panels the user expected to be preserved.

The result is exactly the user-reported regression: open a right-docked panel and a floating panel on cluster A, switch to cluster B, switch back — both panels reappear smashed into the default right dock with the floating group destroyed.

The pre-migration code at v1.4.2 has the byte-identical unmount cleanup, so this isn't a regression introduced by the shared-tabs migration. It's a long-standing latent bug surfacing because the user is now noticing it.

## Compromises taken

- **No persistence to disk.** State lives in memory only. Quit and reopen the app and you start fresh. Adding disk persistence is out of scope for this work.
- **No cross-cluster panel sharing.** Diagnostics and AppLogs are treated as fully cluster-scoped panels even though they could conceptually be "tools" that follow the user across clusters. The simpler model — every dockable panel obeys the same per-cluster rules — wins because it eliminates the entire concept of layered/merged tab groups, scope tags on registrations, and per-panel cluster scope decisions. The cost is that opening Diagnostics on cluster A doesn't auto-open it on cluster B; the user opens it where they want it on each cluster. That cost is real but minor.
- **No popout-to-OS-window for any panel.** Wails v2 doesn't support multiple native windows. The available v2 workarounds (separate sibling executables with IPC, browser-tab fallback, forking Wails) are all worse than waiting for the v3 migration. This design assumes single-window for the foreseeable future.

## Architecture

One `PanelLayoutStore` instance per open cluster. The store grows so it owns BOTH per-panel layout state (already there) AND `tabGroups` (currently in `DockablePanelProvider`'s React `useState`). After this change, "all panel layout state for cluster X" is exactly "the contents of cluster X's store."

```
DockablePanelProvider (mounted at app root, inside KubeconfigProvider)
├── Reads: selectedClusterId, selectedClusterIds (from useKubeconfig)
├── Owns: storesRef = useRef(new Map<string, PanelLayoutStore>())
├── Subscribes: useSyncExternalStore(activeStore.subscribeTabGroups, activeStore.getTabGroups)
├── On selectedClusterId change (useLayoutEffect):
│   ├── Look up or createPanelLayoutStore() for the new cluster
│   ├── setActivePanelLayoutStore(newStore)   ← existing global imperative API
│   └── setActiveStoreState(newStore)         ← triggers re-render with new store
├── On selectedClusterIds change (useEffect):
│   └── Drop Map entries for clusters no longer in selectedClusterIds
└── Provides: PanelLayoutStoreContext.Provider value={activeStore}, plus the
              same DockablePanelContext shape it provides today

PanelLayoutStore (extended with tabGroups slice)
├── Existing: per-panel state Map (panelStates), per-panel listeners,
│             close handlers, all existing methods (getInitialState/getState/
│             updateState/clearPanelState/etc) UNCHANGED
└── NEW:
    ├── tabGroups: TabGroupState                  (initialized via createInitialTabGroupState())
    ├── tabGroupsListeners: Set<() => void>
    ├── getTabGroups(): TabGroupState
    ├── setTabGroups(updater: (prev: TabGroupState) => TabGroupState): void
    └── subscribeTabGroups(listener: () => void): () => void
```

The cluster scoping happens at the store boundary. The provider is a thin coordinator: it picks the active store, hands callbacks (`movePanel`, `syncPanelGroup`, `closeTab`, `reorderTabInGroup`, `movePanelBetweenGroups`, etc.) that operate on whichever store is currently active, and re-renders when the active store's tabGroups change.

`panelRegistrationsRef` and `panelRegistrationsSnapshot` stay app-global. Panel registration metadata (title, kindClass, defaultSize) is identity-level info — Diagnostics' title is "Diagnostics" regardless of which cluster is active — and doesn't need cluster scoping.

### Why this shape over alternatives

- **vs. `tabGroupsByCluster: Record<clusterKey, TabGroupState>` directly in the provider's `useState`:** that also works, but yields two parallel cluster-keyed structures (one for tabGroups in the provider, one for the per-panel store), each requiring its own cleanup. Putting tabGroups inside the store makes them lifecycle-coupled — one store, one slice of state, one cleanup point.
- **vs. inventing a new "cluster store" abstraction:** the `setActivePanelLayoutStore` infrastructure already exists in `panelLayoutStore.ts:218`. It's currently only used by `DockablePanel.behavior.test.tsx` between tests, but its semantics are exactly what we need: "swap which store the imperative call sites consult." Reusing it instead of inventing a new mechanism means fewer concepts and zero new global plumbing.
- **vs. cluster-keyed state inside the existing app-global store:** the store would have to learn about cluster identity, which couples it to KubeconfigContext. Cleaner to leave the store cluster-agnostic and let the provider hold the `Map<clusterKey, Store>`.

## Components

### `PanelLayoutStore` extensions

```ts
// frontend/src/ui/dockable/panelLayoutStore.ts

export interface PanelLayoutStore {
  // ... all existing methods unchanged ...

  // NEW — tabGroups slice
  getTabGroups(): TabGroupState;
  setTabGroups(updater: (prev: TabGroupState) => TabGroupState): void;
  subscribeTabGroups(listener: () => void): () => void;
}

export function createPanelLayoutStore(): PanelLayoutStore {
  const panelStates = new Map<string, PanelLayoutState>();
  const panelListeners = new Map<string, Set<PanelListener>>();
  // ... existing setup ...

  // NEW: tabGroups slice
  let tabGroups: TabGroupState = createInitialTabGroupState();
  const tabGroupsListeners = new Set<() => void>();

  const setTabGroups = (updater: (prev: TabGroupState) => TabGroupState) => {
    const next = updater(tabGroups);
    if (next === tabGroups) return; // bail out on no-op (matches React semantics)
    tabGroups = next;
    tabGroupsListeners.forEach((listener) => listener());
  };

  return {
    // ... existing methods unchanged ...
    getTabGroups: () => tabGroups,
    setTabGroups,
    subscribeTabGroups: (listener) => {
      tabGroupsListeners.add(listener);
      return () => tabGroupsListeners.delete(listener);
    },
  };
}
```

The new tabGroups slice has its own listener channel, separate from `panelListeners`. This keeps the existing per-panel subscription path untouched and means tab-group changes only re-render components that subscribe via the new channel — no thrash on per-panel state subscribers when the tab list changes.

### `DockablePanelProvider` rewiring

```ts
// frontend/src/ui/dockable/DockablePanelProvider.tsx (sketch — not the final code)

export const DockablePanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();

  // One store per cluster. Lazily created on first activation.
  const storesRef = useRef<Map<string, PanelLayoutStore>>(new Map());

  const getOrCreateStoreForCluster = (clusterKey: string): PanelLayoutStore => {
    let store = storesRef.current.get(clusterKey);
    if (!store) {
      store = createPanelLayoutStore();
      storesRef.current.set(clusterKey, store);
    }
    return store;
  };

  // Active store mirrors selectedClusterId. Initialized to a default store
  // for the case where no cluster is selected at first render.
  const [activeStore, setActiveStoreState] = useState<PanelLayoutStore>(() =>
    getOrCreateStoreForCluster(selectedClusterId || '__default__')
  );

  useLayoutEffect(() => {
    const clusterKey = selectedClusterId || '__default__';
    const store = getOrCreateStoreForCluster(clusterKey);
    setActivePanelLayoutStore(store);  // existing imperative global API
    setActiveStoreState(store);
  }, [selectedClusterId]);

  // Prune stores for closed cluster tabs. Mirrors the existing cleanup in
  // ObjectPanelStateContext.tsx.
  useEffect(() => {
    const allowed = new Set(selectedClusterIds ?? []);
    for (const clusterKey of Array.from(storesRef.current.keys())) {
      if (clusterKey !== '__default__' && !allowed.has(clusterKey)) {
        storesRef.current.delete(clusterKey);
      }
    }
  }, [selectedClusterIds]);

  // Subscribe to the active store's tabGroups slice. useSyncExternalStore
  // re-subscribes automatically when the subscribe function identity changes
  // (which it does when activeStore changes via setActiveStoreState).
  const subscribe = useCallback(
    (listener: () => void) => activeStore.subscribeTabGroups(listener),
    [activeStore]
  );
  const getSnapshot = useCallback(() => activeStore.getTabGroups(), [activeStore]);
  const tabGroups = useSyncExternalStore(subscribe, getSnapshot);

  // All callbacks that today do `setTabGroups(prev => ...)` become
  // `activeStore.setTabGroups(prev => ...)`. All `tabGroupsRef.current`
  // reads become `activeStore.getTabGroups()`. The `tabGroupsRef` is deleted.
  const movePanel = useCallback(
    (panelId: string, sourceGroupId: string, targetGroupId: string, insertIndex: number) => {
      // ... unchanged shift-compensation logic ...
      // ... but reads/writes go through `activeStore` instead of useState ...
    },
    [activeStore]
  );

  // ... all other callbacks restructured the same way ...

  return (
    <PanelLayoutStoreContext.Provider value={activeStore}>
      <DockablePanelContext.Provider value={...}>
        {children}
        <div ref={dragPreviewRef} className="dockable-tab-drag-preview" aria-hidden="true">
          <span className="dockable-tab-drag-preview__kind kind-badge" aria-hidden="true" />
          <span className="dockable-tab-drag-preview__label" />
        </div>
      </DockablePanelContext.Provider>
    </PanelLayoutStoreContext.Provider>
  );
};
```

### `DockablePanel.tsx` cleanup removal

The third `useEffect` at lines 321-325 (the unmount-only `removePanelFromGroups`) is **deleted**:

```ts
// DELETE THIS:
useEffect(() => {
  return () => {
    removePanelFromGroups(panelId);
  };
}, [panelId, removePanelFromGroups]);
```

With cluster-scoped stores, every cluster-switch unmount leaves the previous cluster's store untouched (because the active store at unmount time is the *new* cluster's store, and the deleted effect was the only thing trying to mutate at unmount). The old cluster's tab-group memberships persist; switching back finds them intact.

Real close paths still work:

- **Tab-X-button close** in the bar — `closeTab` in the provider explicitly removes the panel from the active store's tabGroups before invoking the panel's `onClose` handler.
- **Panel-header X-button close** — `handleClose` calls `panelState.setOpen(false)`, which propagates through the per-panel subscription, triggers the second `useEffect` with `isOpen=false`, which calls `removePanelFromGroups(panelId)` against the active store.
- **External `setPanelOpenById(panelId, false)` close** — same path as the panel-header X.

All three paths already remove from groups BEFORE the panel actually unmounts (the unmount happens after the parent updates its `openPanels` map in response to the close). The third useEffect was purely defensive cleanup for edge cases that don't actually exist with the explicit close paths in place.

## Data flow

**Cluster switch (A → B):**

1. User clicks cluster B's tab in `ClusterTabs`.
2. `setActiveKubeconfig` runs, `selectedClusterId` updates in `KubeconfigContext`.
3. React re-renders `DockablePanelProvider`. Both effects queue.
4. `useLayoutEffect` runs (synchronous, before children commit): looks up cluster B's store (creates one if absent), calls `setActivePanelLayoutStore(storeB)`, calls `setActiveStoreState(storeB)`. `useSyncExternalStore`'s subscribe identity changes → re-subscribes to `storeB.subscribeTabGroups`. `tabGroups` snapshot now reflects cluster B's tabGroups.
5. `ObjectPanelStateContext` re-renders too (it also reads `selectedClusterId`); its `openPanels` snapshot is now cluster B's openPanels.
6. `AppLayout.tsx` re-renders. `Array.from(openPanels.entries())` produces cluster B's panel set. Cluster A's `<ObjectPanel>` instances unmount; cluster B's mount.
7. Cluster A's panel unmounts fire their cleanup effects. The first useEffect's cleanup calls `unregisterPanel(panelId)` (which still touches the app-global `panelRegistrationsRef`). The second useEffect has no cleanup. The third useEffect is deleted, so nothing touches store A's tabGroups. Store A's state is preserved exactly as it was at the moment of switch.
8. Cluster B's panels mount. Their effects run. The first useEffect calls `registerPanel(...)` (app-global metadata). The second useEffect calls `syncPanelGroup(panelId, panelState.position, defaultGroupKey)` against the active store (now store B). For first-time-on-B panels, this places them at default positions; for panels previously in B, this is a no-op because they're already in the right group from the previous time B was active.

**Cluster switch back (B → A):** symmetric. Store A is still in the Map. Switch makes it active. Cluster A's panels remount (their content becomes valid again). They re-register against store A. `syncPanelGroup` finds them already in the correct groups (because store A's tabGroups was preserved). Layout reappears intact.

**Cluster close (A removed from selectedKubeconfigs):**

1. User clicks X on cluster A's tab → port-forward modal flow → `setSelectedKubeconfigs(without A)`.
2. `selectedClusterIds` shrinks; `selectedClusterId` may switch to a different cluster (or null).
3. `useLayoutEffect` runs first (synchronous): swaps active store to the new cluster's store.
4. `useEffect` runs (asynchronous): prunes `storesRef.current.delete('clusterA-key')`. Store A is now unreferenced; GC reclaims it eventually.
5. There are no listeners on store A at this point — every panel that subscribed to it has unmounted (cluster A's `openPanels` is gone, so AppLayout no longer renders any of its ObjectPanels).
6. Reopening cluster A from the kubeconfig dropdown produces a fresh empty store the next time it becomes active.

**Panel close (any path):**

Unchanged from today, except writes go to `activeStore.setTabGroups(...)` instead of `setTabGroups(...)`. All three close paths described above continue to clean tabGroups before the panel unmounts.

## Edge cases

- **Initial render with no cluster selected:** `selectedClusterId` is `null`. `bootstrapInitialStore` creates a `__default__` store. Active store is the default store. Provider renders normally with empty tabGroups.
- **`__default__` store is never pruned.** The cleanup effect explicitly excludes the `__default__` key. This matches `ObjectPanelStateContext`'s identical exclusion.
- **Switching to a freshly-opened cluster:** the cluster has no entry in `storesRef.current`, so `getOrCreateStoreForCluster` creates one. tabGroups starts empty. The first ObjectPanel opened lands at its default position via `syncPanelGroup`.
- **Closing the active cluster:** `setSelectedKubeconfigs` mutates both `selectedClusterIds` (shrunk) and `selectedClusterId` (possibly nulled or repointed). React batches both updates into one render. `useLayoutEffect` runs the cluster-switch logic against the new `selectedClusterId` first; the cleanup `useEffect` runs after, and by then the active store is the *new* cluster's store, not the closed one. Safe to delete the closed cluster's store.
- **`panelLayoutStoresByCluster.current.size` growth:** bounded by the number of currently-open cluster tabs. Each store is small (a Map of panel states + a TabGroupState). Cluster tab close immediately drops the entry. No leak.
- **Floating group identities:** runtime-generated `floating-{nanoid}` strings live entirely inside the store's tabGroups. Each cluster's store has its own floating groups with their own ids. Switching clusters doesn't touch ids in either direction. Switch back finds the same id in the same store.

## Test plan

### Existing tests

- **`DockablePanel.behavior.test.tsx`** — already calls `setActivePanelLayoutStore(createPanelLayoutStore())` between tests. Continues to work because the store still has all existing methods. The new `tabGroups` slice initializes to `createInitialTabGroupState()` per the factory; tests that don't touch tabGroups behave identically.
- **`DockablePanelProvider.test.tsx`** — currently asserts on `tabGroups` from the provider context. Those assertions still work because the value still has the same shape, just sourced via `useSyncExternalStore` instead of `useState`. Tests that mock `useKubeconfig` may need to add `selectedClusterId` and `selectedClusterIds` if they don't already.
- **`useDockablePanelState.test.tsx`** — exercises per-panel state only. No tabGroups involvement, no changes needed.
- **`DockableTabBar.drag.test.tsx` / `DockableTabBar.test.tsx`** — same as the provider tests; mock `useKubeconfig` to provide a cluster id.

### New tests

1. **Layout persists across cluster switch.** Render a `DockablePanelProvider` with a `useKubeconfig` mock that lets the test mutate `selectedClusterId`. Register two panels on cluster A, place one in the right dock and one in a floating group. Switch to cluster B. Switch back to A. Assert `tabGroups` is byte-equal to the snapshot taken after the original placement, including the floating group's `groupId`.

2. **Layout cleared on cluster tab close.** Place a panel on cluster A in a custom position. Remove A from `selectedKubeconfigs`. Assert `storesRef.current.has('clusterA-key') === false`. Re-add A → switch to it → assert tabGroups is the empty initial state, NOT the previous state.

3. **All panel types are per-cluster.** Register a non-object-panel (e.g., panelId `'diagnostics'`) on cluster A's right dock. Switch to cluster B. Assert cluster B's tabGroups does NOT contain `'diagnostics'`. Open it again on cluster B and dock it bottom. Switch back to A. Assert it's still in the right dock on A and still in the bottom dock on B. (This is the test that proves Option 1: same panelId, different layouts per cluster.)

4. **Removing the band-aid doesn't leak on close.** Construct the close-path scenario: open a panel on cluster A in the right dock, close it via the tab-X-button (`closeTab`), assert it's removed from cluster A's tabGroups before unmount. Then construct the cluster-switch scenario: open a panel on cluster A, switch clusters, switch back, assert the panel is still in cluster A's tabGroups (proving the band-aid is gone AND the cluster scoping works).

5. **Floating group identities survive cluster switch.** Open two panels on cluster A in the same floating group (groupId `floating-xyz`). Switch to B and back. Assert the same `groupId` (`floating-xyz`) is still present in cluster A's tabGroups, with both panels still inside it.

### Manual smoke test

Post-implementation, before declaring done:

1. Open cluster A. Open object panel for some pod. Drag it to floating. Open another object panel, leave it in right dock.
2. Switch to cluster B. Verify cluster A's panels are gone, cluster B starts clean.
3. Open object panel for a pod in cluster B. Dock it to bottom.
4. Switch back to A. Verify the floating panel is still floating in its old position, the right-dock panel is still there.
5. Switch back to B. Verify the bottom-dock panel is still there.
6. Open Diagnostics on B. Dock it to right.
7. Switch to A. Verify A still has its original layout, no Diagnostics.
8. Open Diagnostics on A. Dock it to floating. Switch to B. Verify B still has Diagnostics in the right dock.
9. Close the cluster A tab. Switch to B. Verify B still has its own layout intact.
10. Re-open cluster A from the kubeconfig dropdown. Verify it starts with a clean default layout (everything from before should be GONE).

## File inventory

| Path | Change |
|---|---|
| `frontend/src/ui/dockable/panelLayoutStore.ts` | Extend `PanelLayoutStore` interface and `createPanelLayoutStore()` factory with the tabGroups slice (`getTabGroups`, `setTabGroups`, `subscribeTabGroups`). |
| `frontend/src/ui/dockable/DockablePanelProvider.tsx` | Replace `useState<TabGroupState>` with cluster-keyed `Map<string, PanelLayoutStore>` + `useSyncExternalStore` against the active store's tabGroups slice. Add `useLayoutEffect` for cluster switch and `useEffect` for cluster cleanup. Rewrite all callbacks (`movePanel`, `syncPanelGroup`, `closeTab`, `reorderTabInGroup`, `removePanelFromGroups`, `switchTab`, `movePanelBetweenGroups`, `movePanelBetweenGroupsAndFocus`, `createFloatingGroupWithPanel`) to read/write through `activeStore` instead of useState. Delete `tabGroupsRef`. |
| `frontend/src/ui/dockable/DockablePanel.tsx` | Delete the third `useEffect` (lines 321-325, the unmount-only `removePanelFromGroups`). |
| `frontend/src/ui/dockable/DockablePanelProvider.test.tsx` | Update to mock `useKubeconfig` with `selectedClusterId` / `selectedClusterIds`. Add the five new tests above. |
| `frontend/src/ui/dockable/DockableTabBar.test.tsx` | Update `useKubeconfig` mock if it doesn't already supply cluster fields. |
| `frontend/src/ui/dockable/DockableTabBar.drag.test.tsx` | Same as above. |
| `frontend/src/ui/dockable/panelLayoutStore.test.ts` (if exists; otherwise new) | Add tests for the tabGroups slice methods (get/set/subscribe semantics, listener notification on change, no-op bail). |

No file deletions. No CSS changes. No frontend dependency changes.

## Open questions

- **Do any existing tests fail because they assume an app-global tabGroups singleton across multiple `useKubeconfig` cluster ids?** Likely no — most tests only use one cluster — but the implementer should run the full vitest suite and audit any failures, not just the dockable-specific tests.
- **Does the `panelLayoutStore.applyObjectPanelLayoutDefaults()` method (which iterates `panelStates` to update sizes when the user changes layout defaults in settings) need to iterate ALL stores, not just the active one?** Yes — when the user changes their default panel sizes in settings, every cluster's open object panels should pick up the new defaults. This means the provider needs to expose a way to fan out the call to every store in `storesRef.current`, OR `applyObjectPanelLayoutDefaults` becomes a free function that walks all stores. The implementation plan should resolve this.
