/** Cluster-local tab lifetime and group geometry. Placement lives in tabGroups. */
import { getObjectPanelLayoutDefaults } from '@core/settings/appPreferences';
import {
  createInitialTabGroupState,
  getGroupForPanel,
  getGroupTabs,
  removePanelFromGroup,
} from './tabGroupState';
import type { TabGroupState } from './tabGroupTypes';

export type DockPosition = 'right' | 'bottom' | 'floating';
export interface PanelOpenState {
  isOpen: boolean;
  isInitialized: boolean;
}
export interface GroupLayoutState {
  rightSize: { width: number; height: number };
  bottomSize: { width: number; height: number };
  isMaximized: boolean;
  isInitialized: boolean;
  zIndex: number;
}
type Listener = () => void;
export interface PanelLayoutStore {
  getInitialState(panelId: string): PanelOpenState;
  getState(panelId: string): PanelOpenState | undefined;
  updateState(panelId: string, updates: Partial<PanelOpenState>): void;
  subscribe(panelId: string, listener: Listener): () => void;
  setPanelOpenById(panelId: string, isOpen: boolean): void;
  clearPanelState(panelId: string): void;
  getGroupLayout(groupKey: string): GroupLayoutState;
  updateGroupLayout(groupKey: string, updates: Partial<GroupLayoutState>): void;
  initializeGroupLayout(groupKey: string, size?: { width?: number; height?: number }): void;
  subscribeGroupLayout(groupKey: string, listener: Listener): () => void;
  focusGroup(groupKey: string): void;
  focusPanelById(panelId: string): void;
  applyObjectPanelLayoutDefaults(): void;
  getTabGroups(): TabGroupState;
  setTabGroups(updater: (prev: TabGroupState) => TabGroupState): void;
  subscribeTabGroups(listener: Listener): () => void;
}

function subscribeKey(listeners: Map<string, Set<Listener>>, key: string, listener: Listener) {
  let entries = listeners.get(key);
  if (!entries) {
    entries = new Set();
    listeners.set(key, entries);
  }
  entries.add(listener);
  return () => {
    entries.delete(listener);
    if (entries.size === 0) {
      listeners.delete(key);
    }
  };
}
function notify(listeners?: Set<Listener>) {
  new Set(listeners).forEach((listener) => {
    listener();
  });
}
const layoutsEqual = (left: GroupLayoutState, right: GroupLayoutState) =>
  left.isMaximized === right.isMaximized &&
  left.rightSize.width === right.rightSize.width &&
  left.rightSize.height === right.rightSize.height &&
  left.bottomSize.width === right.bottomSize.width &&
  left.bottomSize.height === right.bottomSize.height &&
  left.isInitialized === right.isInitialized &&
  left.zIndex === right.zIndex;

export function createPanelLayoutStore(initialTabGroups?: TabGroupState): PanelLayoutStore {
  const panels = new Map<string, PanelOpenState>();
  const panelListeners = new Map<string, Set<Listener>>();
  const layouts = new Map<string, GroupLayoutState>();
  const layoutListeners = new Map<string, Set<Listener>>();
  const groupListeners = new Set<Listener>();
  let tabGroups = initialTabGroups ?? createInitialTabGroupState();
  let zIndex = 1000;

  const getInitialState = (panelId: string) => {
    let state = panels.get(panelId);
    if (!state) {
      state = { isOpen: false, isInitialized: false };
      panels.set(panelId, state);
    }
    return state;
  };
  const updateState = (panelId: string, updates: Partial<PanelOpenState>) => {
    const previous = getInitialState(panelId);
    const next = { ...previous, ...updates };
    if (previous.isOpen === next.isOpen && previous.isInitialized === next.isInitialized) {
      return;
    }
    panels.set(panelId, next);
    notify(panelListeners.get(panelId));
  };
  const getGroupLayout = (groupKey: string) => {
    let state = layouts.get(groupKey);
    if (!state) {
      const defaults = getObjectPanelLayoutDefaults();
      state = {
        rightSize: { width: defaults.dockedRightWidth, height: 300 },
        bottomSize: { width: 400, height: defaults.dockedBottomHeight },
        isMaximized: false,
        isInitialized: false,
        zIndex: zIndex++,
      };
      layouts.set(groupKey, state);
    }
    return state;
  };
  const updateGroupLayout = (groupKey: string, updates: Partial<GroupLayoutState>) => {
    const previous = getGroupLayout(groupKey);
    const next = { ...previous, ...updates };
    if (layoutsEqual(previous, next)) {
      return;
    }
    layouts.set(groupKey, next);
    notify(layoutListeners.get(groupKey));
  };
  const focusGroup = (groupKey: string) => updateGroupLayout(groupKey, { zIndex: ++zIndex });
  const setTabGroups = (updater: (prev: TabGroupState) => TabGroupState) => {
    const next = updater(tabGroups);
    if (next === tabGroups) {
      return;
    }
    tabGroups = next;
    // Geometry belongs to the dock, even after its last tab closes. Maximize
    // applies only to the current group and must not survive an empty dock.
    layouts.forEach((layout, key) => {
      if (layout.isMaximized && !getGroupTabs(next, key)?.tabs.length) {
        updateGroupLayout(key, { isMaximized: false });
      }
    });
    notify(groupListeners);
  };
  return {
    getInitialState,
    getState: (id) => panels.get(id),
    updateState,
    subscribe: (id, listener) => subscribeKey(panelListeners, id, listener),
    setPanelOpenById: (id, isOpen) => updateState(id, { isOpen }),
    clearPanelState: (id) => {
      setTabGroups((prev) => removePanelFromGroup(prev, id));
      panels.delete(id);
    },
    getGroupLayout,
    updateGroupLayout,
    initializeGroupLayout: (key, size) => {
      const state = getGroupLayout(key);
      if (state.isInitialized) {
        return;
      }
      updateGroupLayout(key, {
        rightSize: { ...state.rightSize, width: size?.width ?? state.rightSize.width },
        bottomSize: { ...state.bottomSize, height: size?.height ?? state.bottomSize.height },
        isInitialized: true,
      });
    },
    subscribeGroupLayout: (key, listener) => subscribeKey(layoutListeners, key, listener),
    focusGroup,
    focusPanelById: (id) => {
      const group = getGroupForPanel(tabGroups, id);
      if (group) {
        focusGroup(group);
      }
    },
    applyObjectPanelLayoutDefaults: () => {
      const defaults = getObjectPanelLayoutDefaults();
      layouts.forEach((layout, key) => {
        if (!getGroupTabs(tabGroups, key)?.tabs.some((id) => id.startsWith('obj:'))) {
          return;
        }
        updateGroupLayout(key, {
          rightSize: { ...layout.rightSize, width: defaults.dockedRightWidth },
          bottomSize: { ...layout.bottomSize, height: defaults.dockedBottomHeight },
        });
      });
    },
    getTabGroups: () => tabGroups,
    setTabGroups,
    subscribeTabGroups: (listener) => {
      groupListeners.add(listener);
      return () => {
        groupListeners.delete(listener);
      };
    },
  };
}
