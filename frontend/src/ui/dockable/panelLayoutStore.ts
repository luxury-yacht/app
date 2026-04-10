/**
 * panelLayoutStore.ts
 *
 * Store implementation for dockable panel runtime layout state.
 */

import { getContentBounds } from './dockablePanelLayout';
import { getObjectPanelLayoutDefaults } from '@core/settings/appPreferences';
import { createInitialTabGroupState } from './tabGroupState';
import { removePanelFromGroup } from './tabGroupState';
import type { TabGroupState } from './tabGroupTypes';

export type DockPosition = 'right' | 'bottom' | 'floating';

export interface PanelLayoutState {
  position: DockPosition;
  floatingSize: { width: number; height: number };
  rightSize: { width: number; height: number };
  bottomSize: { width: number; height: number };
  floatingPosition: { x: number; y: number };
  isOpen: boolean;
  isInitialized: boolean;
  zIndex: number;
}

// Reasons for panel closure.
export type PanelCloseReason = 'dock-conflict' | 'external';

type PanelListener = () => void;

export interface PanelLayoutStore {
  getInitialState: (panelId: string) => PanelLayoutState;
  getState: (panelId: string) => PanelLayoutState | undefined;
  updateState: (panelId: string, updates: Partial<PanelLayoutState>) => void;
  subscribe: (panelId: string, listener: PanelListener) => () => void;
  focusPanelById: (panelId: string) => void;
  setPanelPositionById: (panelId: string, position: DockPosition) => void;
  setPanelFloatingPositionById: (panelId: string, position: { x: number; y: number }) => void;
  setPanelOpenById: (panelId: string, isOpen: boolean) => void;
  copyPanelLayoutState: (sourcePanelId: string, targetPanelId: string) => void;
  clearPanelState: (panelId: string) => void;
  registerPanelCloseHandler: (panelId: string, handler: (reason: PanelCloseReason) => void) => void;
  unregisterPanelCloseHandler: (
    panelId: string,
    handler: (reason: PanelCloseReason) => void
  ) => void;
  getAllPanelStates: () => Record<string, PanelLayoutState>;
  restorePanelStates: (states: Record<string, PanelLayoutState>) => void;
  /** Apply updated layout defaults to all open object panels. */
  applyObjectPanelLayoutDefaults: () => void;

  /**
   * Returns the current tabGroups state. Reads are synchronous and
   * always reflect the latest value.
   */
  getTabGroups(): TabGroupState;

  /**
   * Replaces the tabGroups state via an updater. If the updater returns
   * the same reference as the previous value, the call is a no-op (no
   * listeners fire). This matches React's setState bail-out semantics.
   *
   * IMPORTANT: the updater MUST return a new object reference to signal
   * a real change. Mutating the previous state in place and returning
   * the same reference will silently drop the update — TypeScript can't
   * catch this. Use immutable helpers from `tabGroupState.ts`
   * (`addPanelToGroup`, `removePanelFromGroup`, etc.) which always
   * return new state objects.
   */
  setTabGroups(updater: (prev: TabGroupState) => TabGroupState): void;

  /**
   * Subscribe to tabGroups changes. The returned function unsubscribes.
   * Per-panel state subscribers are NOT notified by tabGroups changes
   * and vice versa — the channels are independent.
   */
  subscribeTabGroups(listener: () => void): () => void;
}

/**
 * Clamp floating position to keep full panel visible inside content bounds
 * whenever possible.
 */
function clampFloatingPosition(
  position: { x: number; y: number },
  panelSize: { width: number; height: number }
): { x: number; y: number } {
  const content = getContentBounds();
  const maxX = Math.max(0, content.width - panelSize.width);
  const maxY = Math.max(0, content.height - panelSize.height);

  return {
    x: Math.max(0, Math.min(position.x, maxX)),
    y: Math.max(0, Math.min(position.y, maxY)),
  };
}

export function createPanelLayoutStore(): PanelLayoutStore {
  const panelStates = new Map<string, PanelLayoutState>();
  const panelListeners = new Map<string, Set<PanelListener>>();
  const panelCloseHandlers = new Map<string, Set<(reason: PanelCloseReason) => void>>();
  let zIndexCounter = 1000;

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
    // Snapshot the listener set before iterating so any listener that
    // unsubscribes itself (or triggers a re-entrant setTabGroups) sees
    // a consistent iteration order. Without this, a listener that
    // re-enters could cause some listeners to fire twice for one
    // logical update while others are skipped.
    new Set(tabGroupsListeners).forEach((listener) => listener());
  };

  const getInitialState = (panelId: string): PanelLayoutState => {
    if (!panelStates.has(panelId)) {
      const layout = getObjectPanelLayoutDefaults();

      panelStates.set(panelId, {
        position: 'right',
        floatingSize: { width: layout.floatingWidth, height: layout.floatingHeight },
        rightSize: { width: layout.dockedRightWidth, height: 300 },
        bottomSize: { width: 400, height: layout.dockedBottomHeight },
        floatingPosition: { x: layout.floatingX, y: layout.floatingY },
        isOpen: false,
        isInitialized: false,
        zIndex: zIndexCounter++,
      });
    }
    return panelStates.get(panelId)!;
  };

  const notifyListeners = (panelId: string) => {
    const listeners = panelListeners.get(panelId);
    if (!listeners) {
      return;
    }
    listeners.forEach((listener) => listener());
  };

  const updateState = (panelId: string, updates: Partial<PanelLayoutState>) => {
    const currentState = getInitialState(panelId);
    panelStates.set(panelId, { ...currentState, ...updates });
    notifyListeners(panelId);
  };

  const setPanelOpenState = (panelId: string, isOpen: boolean) => {
    updateState(panelId, isOpen ? { isOpen: true, zIndex: ++zIndexCounter } : { isOpen });
  };

  return {
    getInitialState,
    getState: (panelId: string) => panelStates.get(panelId),
    updateState,
    subscribe: (panelId: string, listener: PanelListener) => {
      if (!panelListeners.has(panelId)) {
        panelListeners.set(panelId, new Set());
      }
      const listeners = panelListeners.get(panelId)!;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          panelListeners.delete(panelId);
        }
      };
    },
    focusPanelById: (panelId: string) => {
      updateState(panelId, { zIndex: ++zIndexCounter });
    },
    setPanelPositionById: (panelId: string, position: DockPosition) => {
      updateState(panelId, { position });
    },
    setPanelFloatingPositionById: (panelId: string, position: { x: number; y: number }) => {
      const currentState = getInitialState(panelId);
      updateState(panelId, {
        floatingPosition: clampFloatingPosition(position, currentState.floatingSize),
      });
    },
    setPanelOpenById: (panelId: string, isOpen: boolean) => {
      setPanelOpenState(panelId, isOpen);
    },
    copyPanelLayoutState: (sourcePanelId: string, targetPanelId: string) => {
      if (sourcePanelId === targetPanelId) {
        return;
      }
      const sourceState = panelStates.get(sourcePanelId);
      if (!sourceState) {
        return;
      }
      const targetState = getInitialState(targetPanelId);
      updateState(targetPanelId, {
        // Copy geometry only; group membership controls dock position.
        // Copying `position` here can race with tab-group moves and send tabs to
        // unintended groups when leadership transfers during dock/float actions.
        floatingSize: { ...sourceState.floatingSize },
        rightSize: { ...sourceState.rightSize },
        bottomSize: { ...sourceState.bottomSize },
        floatingPosition: { ...sourceState.floatingPosition },
        zIndex: Math.max(targetState.zIndex, sourceState.zIndex),
      });
    },
    clearPanelState: (panelId: string) => {
      setTabGroups((prev) => removePanelFromGroup(prev, panelId));
      panelStates.delete(panelId);
      panelListeners.delete(panelId);
      panelCloseHandlers.delete(panelId);
    },
    registerPanelCloseHandler: (panelId: string, handler: (reason: PanelCloseReason) => void) => {
      if (!panelCloseHandlers.has(panelId)) {
        panelCloseHandlers.set(panelId, new Set());
      }
      panelCloseHandlers.get(panelId)!.add(handler);
    },
    unregisterPanelCloseHandler: (panelId: string, handler: (reason: PanelCloseReason) => void) => {
      const handlers = panelCloseHandlers.get(panelId);
      if (!handlers) {
        return;
      }
      handlers.delete(handler);
      if (handlers.size === 0) {
        panelCloseHandlers.delete(panelId);
      }
    },
    getAllPanelStates: () => {
      const states: Record<string, PanelLayoutState> = {};
      panelStates.forEach((state, panelId) => {
        states[panelId] = { ...state };
      });
      return states;
    },
    restorePanelStates: (states: Record<string, PanelLayoutState>) => {
      Object.entries(states).forEach(([panelId, state]) => {
        panelStates.set(panelId, { ...state });
        notifyListeners(panelId);
      });
    },
    applyObjectPanelLayoutDefaults: () => {
      const layout = getObjectPanelLayoutDefaults();
      panelStates.forEach((state, panelId) => {
        if (!panelId.startsWith('obj:')) return;
        updateState(panelId, {
          rightSize: { width: layout.dockedRightWidth, height: state.rightSize.height },
          bottomSize: { width: state.bottomSize.width, height: layout.dockedBottomHeight },
          floatingSize: { width: layout.floatingWidth, height: layout.floatingHeight },
          floatingPosition: { x: layout.floatingX, y: layout.floatingY },
        });
      });
    },
    getTabGroups: () => tabGroups,
    setTabGroups,
    subscribeTabGroups: (listener) => {
      tabGroupsListeners.add(listener);
      return () => {
        tabGroupsListeners.delete(listener);
      };
    },
  };
}

// Compatibility singleton for imperative call sites that are not hook-based.
let activePanelLayoutStore: PanelLayoutStore = createPanelLayoutStore();

export function getActivePanelLayoutStore(): PanelLayoutStore {
  return activePanelLayoutStore;
}

export function setActivePanelLayoutStore(store: PanelLayoutStore) {
  activePanelLayoutStore = store;
}
