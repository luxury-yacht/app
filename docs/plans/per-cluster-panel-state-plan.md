# Per-Cluster Panel State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git policy for this repo (overrides any subskill default):** DO NOT run `git add`, `git commit`, `git push`, or any other state-modifying git command. The user manages all commits manually. Tasks end at "report complete," not at "commit."

**Goal:** Make all dockable panel layout state per-cluster — which panels are open, where they're docked, what tab group they belong to, and the per-panel position/size data — so that switching cluster tabs preserves each cluster's full panel layout, and closing a cluster tab clears that cluster's layout entirely.

**Architecture:** One `PanelLayoutStore` instance per open cluster, swapped via the existing `setActivePanelLayoutStore` global API. The store grows to own `tabGroups` alongside its existing per-panel state. `DockablePanelProvider` becomes a thin coordinator that holds a `Map<clusterKey, PanelLayoutStore>`, watches `selectedClusterId` from `useKubeconfig`, and bridges the active store's tabGroups to React via `useSyncExternalStore`. The unmount-only `removePanelFromGroups` band-aid in `DockablePanel.tsx` is deleted because cluster scoping makes it unnecessary and harmful.

**Tech Stack:** TypeScript, React 19, vitest, React's `useSyncExternalStore`. No new runtime dependencies.

**Spec:** [`docs/plans/per-cluster-panel-state-design.md`](./per-cluster-panel-state-design.md). Read it before starting.

---

## File inventory

| Path | Change |
|---|---|
| `frontend/src/ui/dockable/panelLayoutStore.ts` | Extend `PanelLayoutStore` interface and `createPanelLayoutStore()` factory with the tabGroups slice. |
| `frontend/src/ui/dockable/panelLayoutStore.test.ts` | NEW or EXTEND — tests for the tabGroups slice (get/set/subscribe semantics, listener notification, no-op bail-out). |
| `frontend/src/ui/dockable/DockablePanelProvider.tsx` | Replace `useState<TabGroupState>` with cluster-keyed `Map<string, PanelLayoutStore>` + `useSyncExternalStore`. Add `useLayoutEffect` for cluster-switch and `useEffect` for cluster cleanup. Migrate every callback that touches tabGroups. Delete `tabGroupsRef`. Add `applyLayoutDefaultsAcrossClusters` to context value. |
| `frontend/src/ui/dockable/DockablePanel.tsx` | Delete the third `useEffect` (lines 321–325 — the unmount-only `removePanelFromGroups`). |
| `frontend/src/ui/settings/Settings.tsx` | Replace `getActivePanelLayoutStore().applyObjectPanelLayoutDefaults()` (line 337) with the new context-provided fan-out helper. |
| `frontend/src/ui/dockable/DockablePanelProvider.test.tsx` | Add `useKubeconfig` mock. Add 5 new tests (per-cluster persistence, cleanup on close, Diagnostics per-cluster, band-aid removal, floating-group identity). |
| `frontend/src/ui/dockable/DockableTabBar.test.tsx` | Add `useKubeconfig` mock if not already present. |
| `frontend/src/ui/dockable/DockableTabBar.drag.test.tsx` | Add `useKubeconfig` mock if not already present. |

No file deletions. No CSS. No frontend dependency changes.

---

## Background facts to know

- `DockablePanelProvider` is mounted in `frontend/src/App.tsx` inside `KubernetesProvider`, which mounts `KubeconfigProvider` inside it. So `useKubeconfig()` is available to the provider.
- `PanelLayoutStoreContext` lives at `frontend/src/ui/dockable/panelLayoutStoreContext.tsx`. The provider currently passes `panelLayoutStoreRef.current` (a fixed store created on mount) via this context.
- `useDockablePanelState` consumes the store via `usePanelLayoutStoreContext()` at `frontend/src/ui/dockable/useDockablePanelState.ts:85`. When the context value changes (cluster switch), consumers re-render and re-subscribe to per-panel state on the new store.
- `applyObjectPanelLayoutDefaults` is called from `frontend/src/ui/settings/Settings.tsx:337` via the global `getActivePanelLayoutStore()`. With per-cluster stores, this would only update the active cluster's panels. We must fan it out across all stores so settings changes apply uniformly.
- `tabGroupState.ts` exports `createInitialTabGroupState()`, `removePanelFromGroup`, `addPanelToGroup`, `getGroupTabs`, etc. We don't modify any of these — `panelLayoutStore.ts` will just import and use them.
- `ObjectPanelStateContext.tsx:125-139` already implements the cluster-cleanup pattern we're mirroring. Use `__default__` as the fallback key for the "no cluster selected" case to match its convention exactly.
- The third `useEffect` in `DockablePanel.tsx:321-325` is the band-aid — it calls `removePanelFromGroups(panelId)` on unmount. This is what tears up cluster A's tab groups when the user switches to cluster B and is the root cause of the regression.

---

### Task 1: Add tabGroups slice tests to `panelLayoutStore.test.ts`

**Files:**
- Create or extend: `frontend/src/ui/dockable/panelLayoutStore.test.ts`

- [ ] **Step 1: Check whether the test file already exists.**

  Run: `ls /Volumes/git/luxury-yacht/app/frontend/src/ui/dockable/panelLayoutStore.test.ts`

  If it exists, you'll add tests at the bottom. If it doesn't, create it with the imports below.

- [ ] **Step 2: Write the failing tests for the tabGroups slice.**

  If creating from scratch, the file head should be:

  ```ts
  /**
   * frontend/src/ui/dockable/panelLayoutStore.test.ts
   *
   * Tests for the panel layout store, including the tabGroups slice that
   * holds dock-group memberships per store instance (which becomes per
   * cluster once the provider wires up cluster-keyed stores).
   */
  import { describe, it, expect, vi } from 'vitest';
  import { createPanelLayoutStore } from './panelLayoutStore';
  import { addPanelToGroup, createInitialTabGroupState } from './tabGroupState';
  ```

  Append this `describe` block at the bottom of the file:

  ```ts
  describe('createPanelLayoutStore — tabGroups slice', () => {
    it('starts with an empty tabGroups state', () => {
      const store = createPanelLayoutStore();
      expect(store.getTabGroups()).toEqual(createInitialTabGroupState());
    });

    it('setTabGroups applies the updater and updates getTabGroups', () => {
      const store = createPanelLayoutStore();
      store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
      const next = store.getTabGroups();
      expect(next.right.tabs).toEqual(['panel-a']);
    });

    it('subscribeTabGroups notifies listeners on change', () => {
      const store = createPanelLayoutStore();
      const listener = vi.fn();
      store.subscribeTabGroups(listener);
      store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('subscribeTabGroups returns an unsubscribe function', () => {
      const store = createPanelLayoutStore();
      const listener = vi.fn();
      const unsubscribe = store.subscribeTabGroups(listener);
      unsubscribe();
      store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
      expect(listener).not.toHaveBeenCalled();
    });

    it('setTabGroups bails out when the updater returns the same reference', () => {
      const store = createPanelLayoutStore();
      const listener = vi.fn();
      store.subscribeTabGroups(listener);
      store.setTabGroups((prev) => prev); // identity returns same reference
      expect(listener).not.toHaveBeenCalled();
    });

    it('tabGroups slice is independent of per-panel state subscriptions', () => {
      const store = createPanelLayoutStore();
      const tabGroupsListener = vi.fn();
      const panelListener = vi.fn();
      store.subscribeTabGroups(tabGroupsListener);
      store.subscribe('panel-a', panelListener);
      // Mutating tabGroups should NOT notify per-panel listeners.
      store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
      expect(tabGroupsListener).toHaveBeenCalledTimes(1);
      expect(panelListener).not.toHaveBeenCalled();
      // Mutating per-panel state should NOT notify tabGroups listeners.
      tabGroupsListener.mockClear();
      store.updateState('panel-a', { isOpen: true });
      expect(panelListener).toHaveBeenCalled();
      expect(tabGroupsListener).not.toHaveBeenCalled();
    });

    it('each store instance owns an independent tabGroups slice', () => {
      const storeA = createPanelLayoutStore();
      const storeB = createPanelLayoutStore();
      storeA.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
      expect(storeA.getTabGroups().right.tabs).toEqual(['panel-a']);
      expect(storeB.getTabGroups().right.tabs).toEqual([]);
    });
  });
  ```

- [ ] **Step 3: Run the tests to confirm they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/panelLayoutStore.test.ts`

  Expected: failures for `getTabGroups`, `setTabGroups`, `subscribeTabGroups` not being properties of the returned store.

- [ ] **Step 4: Report task complete.**

---

### Task 2: Implement the tabGroups slice in `panelLayoutStore.ts`

**Files:**
- Modify: `frontend/src/ui/dockable/panelLayoutStore.ts`

- [ ] **Step 1: Add the imports.**

  At the top of `panelLayoutStore.ts`, add:

  ```ts
  import { createInitialTabGroupState } from './tabGroupState';
  import type { TabGroupState } from './tabGroupTypes';
  ```

- [ ] **Step 2: Extend the `PanelLayoutStore` interface.**

  Add three new methods to the interface (locate it in the file — it currently exposes `getInitialState`, `getState`, `updateState`, etc.):

  ```ts
  export interface PanelLayoutStore {
    // ... all existing methods unchanged ...

    /**
     * Returns the current tabGroups state. Reads are synchronous and
     * always reflect the latest value.
     */
    getTabGroups(): TabGroupState;

    /**
     * Replaces the tabGroups state via an updater. If the updater returns
     * the same reference, the call is a no-op (no listeners fire). This
     * matches React's setState bail-out semantics.
     */
    setTabGroups(updater: (prev: TabGroupState) => TabGroupState): void;

    /**
     * Subscribe to tabGroups changes. The returned function unsubscribes.
     * Per-panel state subscribers are NOT notified by tabGroups changes
     * and vice versa — the channels are independent.
     */
    subscribeTabGroups(listener: () => void): () => void;
  }
  ```

- [ ] **Step 3: Implement the tabGroups slice inside `createPanelLayoutStore()`.**

  Inside the function body (before the `return { ... }`), after the existing `panelStates`, `panelListeners`, `panelCloseHandlers`, and `zIndexCounter` declarations, add:

  ```ts
  // tabGroups slice — owned by each store instance, independent of
  // per-panel state listeners. Cluster scoping happens at the store
  // boundary: the provider holds one store per cluster.
  let tabGroups: TabGroupState = createInitialTabGroupState();
  const tabGroupsListeners = new Set<() => void>();

  const setTabGroups = (updater: (prev: TabGroupState) => TabGroupState) => {
    const next = updater(tabGroups);
    if (next === tabGroups) {
      // Bail out on no-op (identity-equal) updates so subscribers
      // don't re-render unnecessarily. Mirrors React setState semantics.
      return;
    }
    tabGroups = next;
    tabGroupsListeners.forEach((listener) => listener());
  };
  ```

  In the returned object literal at the bottom of `createPanelLayoutStore()`, add the three methods alongside the existing ones:

  ```ts
  return {
    // ... existing methods unchanged ...
    getTabGroups: () => tabGroups,
    setTabGroups,
    subscribeTabGroups: (listener) => {
      tabGroupsListeners.add(listener);
      return () => {
        tabGroupsListeners.delete(listener);
      };
    },
  };
  ```

- [ ] **Step 4: Run the new tests.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/panelLayoutStore.test.ts`

  Expected: all tests in the new `describe('createPanelLayoutStore — tabGroups slice')` block pass. Existing tests in the file (if any) also pass.

- [ ] **Step 5: Run the full dockable test suite to confirm nothing else broke.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/`

  Expected: all tests pass. The new tabGroups slice is additive — nothing else should regress.

- [ ] **Step 6: Report task complete.**

---

### Task 3: Add `useKubeconfig` import and per-cluster store map to `DockablePanelProvider`

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.tsx`

- [ ] **Step 1: Add the `useKubeconfig` import.**

  Near the top of the file, add:

  ```ts
  import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
  ```

- [ ] **Step 2: Replace the existing `panelLayoutStoreRef` setup with a cluster-keyed Map.**

  Find the existing block at approximately lines 158–169:

  ```ts
  // Provider-scoped panel layout store (Phase 3 migration).
  const panelLayoutStoreRef = useRef(createPanelLayoutStore());
  const previousActiveStoreRef = useRef(getActivePanelLayoutStore());

  // Bridge imperative helper call sites to this provider's store after commit.
  useLayoutEffect(() => {
    previousActiveStoreRef.current = getActivePanelLayoutStore();
    setActivePanelLayoutStore(panelLayoutStoreRef.current);
    return () => {
      setActivePanelLayoutStore(previousActiveStoreRef.current);
    };
  }, []);
  ```

  Replace it with:

  ```ts
  // Per-cluster panel layout stores. Each open cluster gets its own
  // PanelLayoutStore that holds BOTH per-panel state and tabGroups for
  // that cluster. The active store mirrors selectedClusterId. Cluster
  // tab close prunes the entry; switching cluster swaps the active store
  // (synchronously, in useLayoutEffect, so children read the new store
  // before they commit).
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  const storesRef = useRef<Map<string, PanelLayoutStore>>(new Map());

  const getOrCreateStoreForCluster = useCallback(
    (clusterKey: string): PanelLayoutStore => {
      let store = storesRef.current.get(clusterKey);
      if (!store) {
        store = createPanelLayoutStore();
        storesRef.current.set(clusterKey, store);
      }
      return store;
    },
    []
  );

  // Active store tracks selectedClusterId. Initialized to the current
  // cluster's store (or '__default__' if no cluster is selected) on
  // first render so children always have a valid store via context.
  const [activeStore, setActiveStoreState] = useState<PanelLayoutStore>(() =>
    getOrCreateStoreForCluster(selectedClusterId || '__default__')
  );

  // Bridge imperative helper call sites (e.g. Settings.tsx) to the
  // currently-active store. useLayoutEffect runs synchronously after DOM
  // mutations but before useEffect, so the swap is in place before any
  // children that read context commit.
  useLayoutEffect(() => {
    const clusterKey = selectedClusterId || '__default__';
    const store = getOrCreateStoreForCluster(clusterKey);
    setActivePanelLayoutStore(store);
    setActiveStoreState(store);
  }, [selectedClusterId, getOrCreateStoreForCluster]);

  // Prune stores for clusters that have been closed. Mirrors the
  // identical pattern in ObjectPanelStateContext.tsx (which keeps
  // per-cluster `openPanels` slices). The '__default__' key is never
  // pruned — it's the no-cluster-selected slot.
  useEffect(() => {
    const allowed = new Set(selectedClusterIds ?? []);
    for (const clusterKey of Array.from(storesRef.current.keys())) {
      if (clusterKey !== '__default__' && !allowed.has(clusterKey)) {
        storesRef.current.delete(clusterKey);
      }
    }
  }, [selectedClusterIds]);
  ```

- [ ] **Step 3: Add `useCallback` and `useLayoutEffect` to the React import if not already there.**

  Check the existing react import at the top of the file. Ensure both `useCallback` and `useLayoutEffect` are imported. They're likely already imported because the file uses them elsewhere.

- [ ] **Step 4: Run the dockable tests to make sure imports and types are valid (they will fail at the next step's tests, but typecheck must pass for now).**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/tsc --noEmit --project .`

  Expected: clean. The file may have other type errors temporarily because Task 4 hasn't migrated callbacks yet — but the new code added in Step 2 should typecheck on its own.

  If tsc reports type errors specifically about `tabGroupsRef` or `setTabGroups` being unused or undefined, that's expected — leave them for Task 4 to clean up.

- [ ] **Step 5: Report task complete.**

---

### Task 4: Replace `useState<TabGroupState>` with `useSyncExternalStore` in `DockablePanelProvider`

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.tsx`

- [ ] **Step 1: Delete the existing `tabGroups` useState and `tabGroupsRef`.**

  Find these lines (approximately 171–175):

  ```ts
  // Tab group state -- the primary model for which panels live where.
  const [tabGroups, setTabGroups] = useState<TabGroupState>(() => createInitialTabGroupState());
  // Keep latest tabGroups available to stable callbacks without recreating them.
  const tabGroupsRef = useRef<TabGroupState>(tabGroups);
  tabGroupsRef.current = tabGroups;
  ```

  Delete the entire block. Both `tabGroups` (the state) and `tabGroupsRef` are about to be replaced.

- [ ] **Step 2: Add `useSyncExternalStore` subscription to the active store's tabGroups slice.**

  In its place, add:

  ```ts
  // Tab group state lives inside the active cluster's store. Subscribe
  // via useSyncExternalStore so React re-renders on any tabGroups change
  // from any source (drag, close, programmatic move). When the active
  // store changes (cluster switch), the subscribe function identity
  // changes via [activeStore], so useSyncExternalStore re-subscribes to
  // the new store automatically.
  const subscribeTabGroups = useCallback(
    (listener: () => void) => activeStore.subscribeTabGroups(listener),
    [activeStore]
  );
  const getTabGroupsSnapshot = useCallback(
    () => activeStore.getTabGroups(),
    [activeStore]
  );
  const tabGroups = useSyncExternalStore(subscribeTabGroups, getTabGroupsSnapshot);
  ```

- [ ] **Step 3: Add `useSyncExternalStore` to the React import.**

  Locate the existing react import at the top of the file. Add `useSyncExternalStore` to the named imports.

- [ ] **Step 4: Migrate every `setTabGroups((prev) => ...)` call to `activeStore.setTabGroups((prev) => ...)`.**

  Search for all occurrences of `setTabGroups(` in the file. There will be several inside callbacks like `removePanelFromGroups`, `closeTab`, `reorderTabInGroup`, `movePanelBetweenGroups`, `switchTab`, `syncPanelGroup`. For each, replace `setTabGroups(` with `activeStore.setTabGroups(`. Add `activeStore` to each callback's `useCallback` deps array.

  Example — find:

  ```ts
  const removePanelFromGroups = useCallback((panelId: string) => {
    setTabGroups((prev) => removePanelFromGroup(prev, panelId));
  }, []);
  ```

  Replace with:

  ```ts
  const removePanelFromGroups = useCallback(
    (panelId: string) => {
      activeStore.setTabGroups((prev) => removePanelFromGroup(prev, panelId));
    },
    [activeStore]
  );
  ```

  Apply the same transformation to every other callback that calls `setTabGroups`. Don't change the inner updater logic — only the wrapper call.

- [ ] **Step 5: Migrate every `tabGroupsRef.current` read to `activeStore.getTabGroups()`.**

  Search for `tabGroupsRef.current` in the file. Replace each occurrence with `activeStore.getTabGroups()`. The most likely callsites are inside `movePanel` (the shift-compensation read) and possibly inside `syncPanelGroup` or memoised values.

  Example — find:

  ```ts
  const groupTabs = getGroupTabs(tabGroupsRef.current, targetGroupId as GroupKey)?.tabs ?? [];
  ```

  Replace with:

  ```ts
  const groupTabs = getGroupTabs(activeStore.getTabGroups(), targetGroupId as GroupKey)?.tabs ?? [];
  ```

  Add `activeStore` to the enclosing callback's deps if it isn't already there.

- [ ] **Step 6: Update `PanelLayoutStoreContext.Provider` to provide `activeStore` instead of `panelLayoutStoreRef.current`.**

  Find the JSX (approximately line 639):

  ```tsx
  <PanelLayoutStoreContext.Provider value={panelLayoutStoreRef.current}>
  ```

  Replace with:

  ```tsx
  <PanelLayoutStoreContext.Provider value={activeStore}>
  ```

- [ ] **Step 7: Run the typecheck.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/tsc --noEmit --project .`

  Expected: clean. Any references to the deleted `tabGroupsRef` or `setTabGroups` (the React useState setter) must now be gone.

- [ ] **Step 8: Run the dockable test suite.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/`

  Expected: existing tests still pass. Some tests may fail because their `useKubeconfig` mocks don't supply `selectedClusterId`/`selectedClusterIds`. If so, fix the mocks (Task 9 covers this) — but verify the failures are mock-related, not logic-related.

- [ ] **Step 9: Report task complete.**

---

### Task 5: Delete the unmount-only `removePanelFromGroups` band-aid from `DockablePanel.tsx`

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanel.tsx`

- [ ] **Step 1: Delete the third `useEffect`.**

  Find this block (approximately lines 321–325):

  ```ts
  useEffect(() => {
    return () => {
      removePanelFromGroups(panelId);
    };
  }, [panelId, removePanelFromGroups]);
  ```

  Delete the entire effect. Don't replace it with anything.

  This effect was the band-aid that tore down tab-group memberships on every panel unmount. With per-cluster stores, cluster-switch unmounts must NOT touch the previous cluster's tab groups (the slice is preserved as-is for that cluster), and explicit close paths already handle group removal:

  - Tab-X-button close → `closeTab` in the provider explicitly removes the panel from tabGroups before calling `registration.onClose`.
  - Panel-header X-button close → `handleClose` calls `panelState.setOpen(false)`, which propagates through the per-panel subscription, triggers the second `useEffect` with `isOpen=false`, which calls `removePanelFromGroups(panelId)`.
  - External `setPanelOpenById(panelId, false)` close → same path as above.

- [ ] **Step 2: Run the typecheck.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/tsc --noEmit --project .`

  Expected: clean.

- [ ] **Step 3: Run the dockable test suite.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/`

  Expected: existing tests still pass. None of the existing tests should rely on the band-aid (it was defensive cleanup for edge cases, not exercised by any test).

  If a test now fails because it explicitly relied on a panel being removed from tabGroups on unmount (without going through a real close path), update the test to use a real close path instead.

- [ ] **Step 4: Report task complete.**

---

### Task 6: Add `applyLayoutDefaultsAcrossClusters` to the provider's context value

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.tsx`
- Modify: `frontend/src/ui/settings/Settings.tsx`

- [ ] **Step 1: Add the helper to the provider.**

  Inside `DockablePanelProvider`, alongside the other callbacks, add:

  ```ts
  // Fan out applyObjectPanelLayoutDefaults to every cluster's store.
  // Called by Settings.tsx when the user changes the default object
  // panel layout — every cluster's open object panels should pick up
  // the new defaults, not just the active cluster's.
  const applyLayoutDefaultsAcrossClusters = useCallback(() => {
    storesRef.current.forEach((store) => {
      store.applyObjectPanelLayoutDefaults();
    });
  }, []);
  ```

- [ ] **Step 2: Add `applyLayoutDefaultsAcrossClusters` to the context value type.**

  Find the `DockablePanelContextValue` interface in the file. Add:

  ```ts
  applyLayoutDefaultsAcrossClusters: () => void;
  ```

- [ ] **Step 3: Add it to the `useMemo` context value object.**

  Find the existing `useMemo<DockablePanelContextValue>(() => ({ ... }))` and add `applyLayoutDefaultsAcrossClusters` to the returned object. Add `applyLayoutDefaultsAcrossClusters` to the deps array.

- [ ] **Step 4: Update `Settings.tsx` to use the new helper.**

  Find this block (approximately lines 335–337):

  ```ts
  setPanelLayout(updated);
  setObjectPanelLayoutDefaults(updated);
  getActivePanelLayoutStore().applyObjectPanelLayoutDefaults();
  ```

  Add the import at the top:

  ```ts
  import { useDockablePanelContext } from '@ui/dockable/DockablePanelProvider';
  ```

  Inside the component body (near the other context consumers), read the helper:

  ```ts
  const { applyLayoutDefaultsAcrossClusters } = useDockablePanelContext();
  ```

  Replace the `getActivePanelLayoutStore().applyObjectPanelLayoutDefaults()` call with:

  ```ts
  applyLayoutDefaultsAcrossClusters();
  ```

  Remove the now-unused `getActivePanelLayoutStore` import from Settings.tsx if nothing else in the file uses it.

- [ ] **Step 5: Run the typecheck.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/tsc --noEmit --project .`

  Expected: clean.

- [ ] **Step 6: Run the settings tests.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/settings/`

  Expected: pass. If any test mocks `useDockablePanelContext` and was missing this field, add the mock.

- [ ] **Step 7: Report task complete.**

---

### Task 7: Add per-cluster persistence test (cluster A → B → A round trip)

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`

- [ ] **Step 1: Read the existing test file to understand its setup.**

  Read `frontend/src/ui/dockable/DockablePanelProvider.test.tsx` in full. Note how it mocks dependencies and renders the provider. Existing tests likely render the provider with no cluster wiring; this task adds tests that DO require cluster wiring.

- [ ] **Step 2: Add (or extend) the `useKubeconfig` mock.**

  At the top of the test file (after the imports), add a vi.mock for `@modules/kubernetes/config/KubeconfigContext`:

  ```ts
  // Per-cluster panel state work added cluster awareness to the provider.
  // Tests that don't care about clusters can leave selectedClusterId at
  // its default; tests that need to switch clusters use vi.mocked() to
  // change the mock return value between renders.
  vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
    useKubeconfig: vi.fn(() => ({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      // Other useKubeconfig fields aren't read by DockablePanelProvider,
      // so we leave them undefined. Add stubs only if a future test
      // needs them.
    })),
  }));
  ```

  If `vi` isn't imported, add `import { vi } from 'vitest';` to the imports.

- [ ] **Step 3: Add the cluster-switch persistence test.**

  Append to the existing test file:

  ```ts
  describe('DockablePanelProvider — per-cluster panel state', () => {
    let container: HTMLDivElement;
    let root: ReactDOM.Root;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = ReactDOM.createRoot(container);
      // Reset useKubeconfig mock to cluster-a between tests.
      const { useKubeconfig } = require('@modules/kubernetes/config/KubeconfigContext');
      vi.mocked(useKubeconfig).mockReturnValue({
        selectedClusterId: 'cluster-a',
        selectedClusterIds: ['cluster-a', 'cluster-b'],
      });
    });

    afterEach(() => {
      act(() => {
        root.unmount();
      });
      container.remove();
      vi.clearAllMocks();
    });

    it('preserves tabGroups across cluster switch round-trip', () => {
      // Capture the provider context value via a probe so we can call
      // its actions and read tabGroups across renders.
      let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
      function Probe() {
        capturedCtx = useDockablePanelContext();
        return null;
      }

      // Render with cluster-a active. Place panel-a in the right dock.
      act(() => {
        root.render(
          <DockablePanelProvider>
            <Probe />
          </DockablePanelProvider>
        );
      });
      act(() => {
        capturedCtx!.registerPanel({
          panelId: 'panel-a',
          title: 'Panel A',
          position: 'right',
        });
        capturedCtx!.syncPanelGroup('panel-a', 'right', undefined);
      });
      // Verify panel-a is in cluster-a's right dock.
      expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);

      // Switch to cluster-b.
      const { useKubeconfig } = require('@modules/kubernetes/config/KubeconfigContext');
      vi.mocked(useKubeconfig).mockReturnValue({
        selectedClusterId: 'cluster-b',
        selectedClusterIds: ['cluster-a', 'cluster-b'],
      });
      act(() => {
        root.render(
          <DockablePanelProvider>
            <Probe />
          </DockablePanelProvider>
        );
      });
      // Cluster-b's tabGroups should be empty.
      expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);

      // Switch back to cluster-a.
      vi.mocked(useKubeconfig).mockReturnValue({
        selectedClusterId: 'cluster-a',
        selectedClusterIds: ['cluster-a', 'cluster-b'],
      });
      act(() => {
        root.render(
          <DockablePanelProvider>
            <Probe />
          </DockablePanelProvider>
        );
      });
      // Cluster-a's tabGroups should be intact: panel-a still in right dock.
      expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);
    });
  });
  ```

  Add the necessary imports at the top of the file if not present:

  ```ts
  import * as React from 'react';
  import ReactDOM from 'react-dom/client';
  import { act } from 'react';
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';
  ```

- [ ] **Step 4: Run the new test.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/DockablePanelProvider.test.tsx -t 'preserves tabGroups across cluster switch'`

  Expected: pass.

- [ ] **Step 5: Report task complete.**

---

### Task 8: Add cluster-cleanup test (close cluster tab → state cleared)

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`

- [ ] **Step 1: Append the test inside the existing `describe('DockablePanelProvider — per-cluster panel state')` block.**

  ```ts
  it('clears a cluster store when the cluster tab is closed', () => {
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    // Start with cluster-a active and a panel in the right dock.
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    act(() => {
      capturedCtx!.registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      capturedCtx!.syncPanelGroup('panel-a', 'right', undefined);
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);

    // Close cluster-a (remove from selectedKubeconfigs). The cleanup
    // effect should drop cluster-a's store. Switch to cluster-b at the
    // same time, since closing the active cluster typically activates
    // a different one.
    const { useKubeconfig } = require('@modules/kubernetes/config/KubeconfigContext');
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });

    // Cluster-b is now active and its tabGroups is empty.
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);

    // Re-open cluster-a. Its store should be re-created fresh, NOT
    // restored from the previous state.
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    // Cluster-a's tabGroups should be empty (fresh state, not the
    // previous panel-a placement).
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);
  });
  ```

- [ ] **Step 2: Run the test.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/DockablePanelProvider.test.tsx -t 'clears a cluster store'`

  Expected: pass.

- [ ] **Step 3: Report task complete.**

---

### Task 9: Add Diagnostics-style per-cluster test (same panelId, different layouts per cluster)

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`

- [ ] **Step 1: Append inside the same `describe` block.**

  ```ts
  it('treats fixed-id panels (e.g. diagnostics) as per-cluster too', () => {
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    const { useKubeconfig } = require('@modules/kubernetes/config/KubeconfigContext');

    // Cluster-a: dock 'diagnostics' to the right.
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    act(() => {
      capturedCtx!.registerPanel({
        panelId: 'diagnostics',
        title: 'Diagnostics',
        position: 'right',
      });
      capturedCtx!.syncPanelGroup('diagnostics', 'right', undefined);
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['diagnostics']);

    // Cluster-b: empty (diagnostics not present in this cluster's slice).
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);
    expect(capturedCtx!.tabGroups.bottom.tabs).toEqual([]);

    // Open diagnostics on cluster-b and dock it to the bottom.
    act(() => {
      capturedCtx!.registerPanel({
        panelId: 'diagnostics',
        title: 'Diagnostics',
        position: 'bottom',
      });
      capturedCtx!.syncPanelGroup('diagnostics', 'bottom', undefined);
    });
    expect(capturedCtx!.tabGroups.bottom.tabs).toEqual(['diagnostics']);

    // Switch back to cluster-a. Diagnostics should still be in the
    // right dock for cluster-a (NOT bottom).
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['diagnostics']);
    expect(capturedCtx!.tabGroups.bottom.tabs).toEqual([]);

    // And cluster-b still has it in the bottom dock.
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(capturedCtx!.tabGroups.bottom.tabs).toEqual(['diagnostics']);
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);
  });
  ```

- [ ] **Step 2: Run the test.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/DockablePanelProvider.test.tsx -t 'treats fixed-id panels'`

  Expected: pass. This is the test that proves Option 1 works: same panelId, different layouts per cluster.

- [ ] **Step 3: Report task complete.**

---

### Task 10: Add band-aid removal regression test

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`

- [ ] **Step 1: Append inside the same `describe` block.**

  ```ts
  it('does not strip tab-group membership when a panel unmounts mid-cluster', () => {
    // Regression test for the third useEffect band-aid that previously
    // tore up tabGroups on every panel unmount. With per-cluster stores
    // and the band-aid removed, an unmount-without-close should leave
    // the cluster's tabGroups untouched.
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    act(() => {
      capturedCtx!.registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      capturedCtx!.syncPanelGroup('panel-a', 'right', undefined);
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);

    // Simulate the panel unregistering (e.g. parent component re-rendered
    // and dropped this panel from its render output) WITHOUT calling any
    // explicit close path. With the band-aid in place, this would have
    // also called removePanelFromGroups. Without it, tabGroups stays.
    act(() => {
      capturedCtx!.unregisterPanel('panel-a');
    });

    // tabGroups should still contain panel-a — the unmount path doesn't
    // remove it. Only an explicit close path would.
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);
  });
  ```

- [ ] **Step 2: Run the test.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/DockablePanelProvider.test.tsx -t 'does not strip tab-group membership'`

  Expected: pass.

- [ ] **Step 3: Report task complete.**

---

### Task 11: Add floating-group identity test

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`

- [ ] **Step 1: Append inside the same `describe` block.**

  ```ts
  it('preserves floating group identities across cluster switches', () => {
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    const { useKubeconfig } = require('@modules/kubernetes/config/KubeconfigContext');
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });

    // Place two panels in the same floating group on cluster-a.
    act(() => {
      capturedCtx!.registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'floating',
      });
      capturedCtx!.registerPanel({
        panelId: 'panel-b',
        title: 'Panel B',
        position: 'floating',
      });
      capturedCtx!.syncPanelGroup('panel-a', 'floating', undefined);
      capturedCtx!.syncPanelGroup('panel-b', 'floating', undefined);
    });

    // Both panels should now be in the SAME floating group.
    const floatingBefore = capturedCtx!.tabGroups.floating;
    expect(floatingBefore.length).toBeGreaterThanOrEqual(1);
    const groupContaining = floatingBefore.find(
      (g) => g.tabs.includes('panel-a') && g.tabs.includes('panel-b')
    );
    expect(groupContaining).toBeDefined();
    const originalGroupId = groupContaining!.groupId;

    // Switch to cluster-b and back.
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    vi.mocked(useKubeconfig).mockReturnValue({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });

    // The same floating group with the same groupId should be present.
    const floatingAfter = capturedCtx!.tabGroups.floating;
    const restoredGroup = floatingAfter.find((g) => g.groupId === originalGroupId);
    expect(restoredGroup).toBeDefined();
    expect(restoredGroup!.tabs).toEqual(expect.arrayContaining(['panel-a', 'panel-b']));
  });
  ```

- [ ] **Step 2: Run the test.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run src/ui/dockable/DockablePanelProvider.test.tsx -t 'preserves floating group identities'`

  Expected: pass.

- [ ] **Step 3: Report task complete.**

---

### Task 12: Audit and fix any failing tests in the broader frontend suite

**Files:**
- Various — may need to update mocks in any test that renders `DockablePanelProvider` (directly or transitively) without supplying a `useKubeconfig` mock.

- [ ] **Step 1: Run the full frontend test suite.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run 2>&1 | tail -80`

- [ ] **Step 2: Triage failures.**

  For each failing test:
  - If the failure is "useKubeconfig is not a function" or similar, the test mounts `DockablePanelProvider` (or a component that consumes it) without mocking `@modules/kubernetes/config/KubeconfigContext`. Add the same vi.mock that Task 7 added.
  - If the failure references `tabGroups` having unexpected shape, the test was relying on the old useState behaviour. Update it to use the new context API.
  - If the failure is unrelated to this work (e.g. a flaky test, or a test that was already broken), leave it alone and note it in your report.

- [ ] **Step 3: Re-run the suite until all DockablePanel-related failures are resolved.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && ./node_modules/.bin/vitest run 2>&1 | tail -80`

  Expected: all tests pass, OR the only failures are unrelated to this work (note them in the report).

- [ ] **Step 4: Report task complete with a list of any tests that needed mock updates.**

---

### Task 13: Run the full prerelease QC gate

**Files:**
- No changes.

- [ ] **Step 1: Run `mage qc:prerelease`.**

  Run: `cd /Volumes/git/luxury-yacht/app && mage qc:prerelease 2>&1 | tail -25`

  Expected: clean exit. All Go tests, frontend tests, lint, typecheck, format, trivy scan all green.

- [ ] **Step 2: If the gate fails, fix the root cause.**

  Do NOT bypass any check. Do NOT use `--no-verify` or skip steps. If a check fails, identify the root cause and fix it. If you can't, report BLOCKED with details.

- [ ] **Step 3: Report task complete with the gate output.**

---

## Manual smoke test (post-implementation, performed by the user)

After all tasks complete and the QC gate is green, the user runs the manual smoke test from the spec:

1. Open cluster A. Open object panel for some pod. Drag it to floating. Open another object panel, leave it in right dock.
2. Switch to cluster B. Verify cluster A's panels are gone, cluster B starts clean.
3. Open object panel for a pod in cluster B. Dock it to bottom.
4. Switch back to A. Verify the floating panel is still floating in its old position, the right-dock panel is still there.
5. Switch back to B. Verify the bottom-dock panel is still there.
6. Open Diagnostics on B. Dock it to right.
7. Switch to A. Verify A still has its original layout, no Diagnostics.
8. Open Diagnostics on A. Dock it to floating. Switch to B. Verify B still has Diagnostics in the right dock.
9. Close the cluster A tab. Switch to B. Verify B still has its own layout intact.
10. Re-open cluster A from the kubeconfig dropdown. Verify it starts with a clean default layout.

Subagents do NOT perform the manual smoke test — it requires a running app and human interaction.
