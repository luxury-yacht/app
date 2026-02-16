/**
 * panelLayoutStore.ts
 *
 * Store implementation for dockable panel runtime layout state.
 * A default global store is provided for compatibility, while
 * DockablePanelProvider can install a provider-scoped active store.
 */

import { getContentBounds } from './dockablePanelLayout';

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
  const panelCloseHandlers = new Map<string, (reason: PanelCloseReason) => void>();
  let zIndexCounter = 1000;

  const getInitialState = (panelId: string): PanelLayoutState => {
    if (!panelStates.has(panelId)) {
      const defaultFloatingWidth = 600;
      const defaultFloatingHeight = 400;
      const content = getContentBounds();
      const centerX = Math.max(100, (content.width - defaultFloatingWidth) / 2);
      const centerY = Math.max(100, (content.height - defaultFloatingHeight) / 2);

      panelStates.set(panelId, {
        position: 'right',
        floatingSize: { width: defaultFloatingWidth, height: defaultFloatingHeight },
        rightSize: { width: 400, height: 300 },
        bottomSize: { width: 400, height: 300 },
        floatingPosition: { x: centerX, y: centerY },
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
    if (panelId === 'app-logs') {
      import('../../../wailsjs/go/backend/App').then(({ SetLogsPanelVisible }) => {
        SetLogsPanelVisible(isOpen);
      });
    }
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
      panelStates.delete(panelId);
      panelListeners.delete(panelId);
    },
    registerPanelCloseHandler: (panelId: string, handler: (reason: PanelCloseReason) => void) => {
      panelCloseHandlers.set(panelId, handler);
    },
    unregisterPanelCloseHandler: (panelId: string, handler: (reason: PanelCloseReason) => void) => {
      const existing = panelCloseHandlers.get(panelId);
      if (existing === handler) {
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
  };
}

let activePanelLayoutStore: PanelLayoutStore | null = null;

export function getActivePanelLayoutStore(): PanelLayoutStore {
  if (!activePanelLayoutStore) {
    throw new Error('Dockable panel layout store is unavailable without DockablePanelProvider');
  }
  return activePanelLayoutStore;
}

export function setActivePanelLayoutStore(store: PanelLayoutStore | null) {
  activePanelLayoutStore = store;
}
