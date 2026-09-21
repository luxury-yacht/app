/**
 * panelLayoutStore.ts
 *
 * Store implementation for dockable panel runtime layout state.
 */

import { getObjectPanelLayoutDefaults } from '@core/settings/appPreferences';
import {
  createInitialTabGroupState,
  getGroupForPanel,
  getGroupTabs,
  removePanelFromGroup,
} from './tabGroupState';
import type { TabGroupState } from './tabGroupTypes';

export type DockPosition = 'right' | 'bottom' | 'floating';

export interface PanelLayoutState {
  rightSize: { width: number; height: number };
  bottomSize: { width: number; height: number };
  isMaximized: boolean;
  isOpen: boolean;
  isInitialized: boolean;
  zIndex: number;
}

type PanelListener = () => void;

export interface PanelLayoutStore {
  getInitialState: (panelId: string) => PanelLayoutState;
  getState: (panelId: string) => PanelLayoutState | undefined;
  updateState: (panelId: string, updates: Partial<PanelLayoutState>) => void;
  subscribe: (panelId: string, listener: PanelListener) => () => void;
  focusPanelById: (panelId: string) => void;
  setPanelOpenById: (panelId: string, isOpen: boolean) => void;
  copyPanelLayoutState: (sourcePanelId: string, targetPanelId: string) => void;
  clearPanelState: (panelId: string) => void;
  handoffLayoutBeforeClose: (panelId: string) => void;
  getGroupLeader: (groupKey: string) => string | undefined;
  setGroupLeader: (groupKey: string, panelId: string) => void;
  clearGroupLeader: (groupKey: string) => void;
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

const layoutsEqual = (left: PanelLayoutState, right: PanelLayoutState) =>
  left.isMaximized === right.isMaximized &&
  left.isOpen === right.isOpen &&
  left.rightSize.width === right.rightSize.width &&
  left.rightSize.height === right.rightSize.height &&
  left.bottomSize.width === right.bottomSize.width &&
  left.bottomSize.height === right.bottomSize.height &&
  left.isInitialized === right.isInitialized &&
  left.zIndex === right.zIndex;

export function createPanelLayoutStore(initialTabGroups?: TabGroupState): PanelLayoutStore {
  const panelStates = new Map<string, PanelLayoutState>();
  const panelListeners = new Map<string, Set<PanelListener>>();
  const groupLeaders = new Map<string, string>();
  let zIndexCounter = 1000;

  // tabGroups slice — owned by each store instance, independent of
  // per-panel state listeners. Cluster scoping happens at the store
  // boundary: the provider holds one store per cluster.
  let tabGroups: TabGroupState = initialTabGroups ?? createInitialTabGroupState();
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
    new Set(tabGroupsListeners).forEach((listener) => {
      listener();
    });
  };

  const getInitialState = (panelId: string): PanelLayoutState => {
    const existing = panelStates.get(panelId);
    if (existing) {
      return existing;
    }
    const layout = getObjectPanelLayoutDefaults();
    const initialState: PanelLayoutState = {
      rightSize: { width: layout.dockedRightWidth, height: 300 },
      bottomSize: { width: 400, height: layout.dockedBottomHeight },
      isMaximized: false,
      isOpen: false,
      isInitialized: false,
      zIndex: zIndexCounter++,
    };
    panelStates.set(panelId, initialState);
    return initialState;
  };

  const notifyListeners = (panelId: string) => {
    const listeners = panelListeners.get(panelId);
    if (!listeners) {
      return;
    }
    listeners.forEach((listener) => {
      listener();
    });
  };

  const publishState = (panelId: string, next: PanelLayoutState) => {
    const current = panelStates.get(panelId);
    // Preserve the hook's no-op render bailout while retaining store notifications.
    panelStates.set(panelId, current && layoutsEqual(current, next) ? current : next);
    notifyListeners(panelId);
  };

  const updateState = (panelId: string, updates: Partial<PanelLayoutState>) => {
    publishState(panelId, { ...getInitialState(panelId), ...updates });
  };

  const setPanelOpenState = (panelId: string, isOpen: boolean) => {
    updateState(panelId, isOpen ? { isOpen: true, zIndex: ++zIndexCounter } : { isOpen });
  };

  const copyPanelLayoutState = (sourcePanelId: string, targetPanelId: string) => {
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
      rightSize: { ...sourceState.rightSize },
      bottomSize: { ...sourceState.bottomSize },
      isMaximized: sourceState.isMaximized,
      zIndex: Math.max(targetState.zIndex, sourceState.zIndex),
    });
  };

  return {
    getInitialState,
    getState: (panelId: string) => panelStates.get(panelId),
    updateState,
    subscribe: (panelId: string, listener: PanelListener) => {
      let listeners = panelListeners.get(panelId);
      if (!listeners) {
        listeners = new Set();
        panelListeners.set(panelId, listeners);
      }
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
    setPanelOpenById: setPanelOpenState,
    copyPanelLayoutState,
    handoffLayoutBeforeClose: (panelId: string) => {
      const currentGroupKey = getGroupForPanel(tabGroups, panelId);
      if (!currentGroupKey) {
        return;
      }

      const currentGroup = getGroupTabs(tabGroups, currentGroupKey);
      const currentLeader = groupLeaders.get(currentGroupKey) ?? currentGroup?.tabs[0] ?? null;
      const nextTabGroups = removePanelFromGroup(tabGroups, panelId);
      const nextGroup = getGroupTabs(nextTabGroups, currentGroupKey);
      const nextLeader = nextGroup?.tabs[0] ?? null;

      if (currentLeader === panelId && nextLeader) {
        copyPanelLayoutState(panelId, nextLeader);
      }
    },
    getGroupLeader: (groupKey) => groupLeaders.get(groupKey),
    setGroupLeader: (groupKey: string, panelId: string) => {
      groupLeaders.set(groupKey, panelId);
    },
    clearGroupLeader: (groupKey: string) => {
      groupLeaders.delete(groupKey);
    },
    clearPanelState: (panelId: string) => {
      setTabGroups((prev) => removePanelFromGroup(prev, panelId));
      panelStates.delete(panelId);
      panelListeners.delete(panelId);
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
        publishState(panelId, { ...state });
      });
    },
    applyObjectPanelLayoutDefaults: () => {
      const layout = getObjectPanelLayoutDefaults();
      panelStates.forEach((state, panelId) => {
        if (!panelId.startsWith('obj:')) {
          return;
        }
        updateState(panelId, {
          rightSize: { width: layout.dockedRightWidth, height: state.rightSize.height },
          bottomSize: { width: state.bottomSize.width, height: layout.dockedBottomHeight },
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
