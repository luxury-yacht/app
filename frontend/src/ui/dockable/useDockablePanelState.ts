/**
 * useDockablePanelState.ts
 *
 * Hook and compatibility exports for dockable panel runtime state.
 * Runtime storage is delegated to the active panel layout store.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  type DockPosition,
  getActivePanelLayoutStore,
  type PanelLayoutState,
} from './panelLayoutStore';
import { usePanelLayoutStoreContext } from './panelLayoutStoreContext';

interface InitializeOptions {
  position?: DockPosition;
  size?: { width?: number; height?: number };
  isOpen?: boolean;
}

export type { DockPosition };

/**
 * Bring a panel to the front by bumping its z-index.
 * Used by provider-level focus actions.
 */
export function focusPanelById(panelId: string) {
  getActivePanelLayoutStore().focusPanelById(panelId);
}

/**
 * Remove a panel's stored state entirely.
 */
export function clearPanelState(panelId: string) {
  getActivePanelLayoutStore().clearPanelState(panelId);
}

export function handoffLayoutBeforeClose(panelId: string) {
  getActivePanelLayoutStore().handoffLayoutBeforeClose(panelId);
}

export function useDockablePanelState(panelId: string) {
  const store = usePanelLayoutStoreContext();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(panelId, listener),
    [panelId, store]
  );
  // Keep the latest layout for this observer's identity. Closing can evict it
  // before unmount, and reverting to mount defaults would reinitialize the panel.
  const getSnapshot = useMemo(() => {
    let lastSnapshot = store.getInitialState(panelId);
    return () => {
      lastSnapshot = store.getState(panelId) ?? lastSnapshot;
      return lastSnapshot;
    };
  }, [panelId, store]);
  const localState = useSyncExternalStore(subscribe, getSnapshot);

  const initialize = useCallback(
    (options: InitializeOptions) => {
      if (localState.isInitialized) {
        return;
      }
      const defaultSize = options.size || {};
      const finalIsOpen = options.isOpen ?? localState.isOpen;
      const targetPosition = options.position ?? localState.position;

      // Only apply defaultSize when the store used generic fallback values.
      // Object panels have user-configured sizes set by getInitialState —
      // those should not be overwritten by PANEL_DEFAULTS from DockablePanel.
      const isObjectPanel = panelId.startsWith('obj:');
      store.updateState(panelId, {
        position: targetPosition,
        rightSize: {
          width:
            (isObjectPanel ? localState.rightSize.width : defaultSize.width) ??
            localState.rightSize.width,
          height: localState.rightSize.height,
        },
        bottomSize: {
          width: localState.bottomSize.width,
          height:
            (isObjectPanel ? localState.bottomSize.height : defaultSize.height) ??
            localState.bottomSize.height,
        },
        isMaximized: localState.isMaximized,
        isOpen: finalIsOpen,
        isInitialized: true,
      });
    },
    [panelId, localState, store]
  );

  const setPosition = useCallback(
    (position: DockPosition) => {
      store.setPanelPositionById(panelId, position);
    },
    [panelId, store]
  );

  const setSize = useCallback(
    (size: { width: number; height: number }) => {
      const updates: Partial<PanelLayoutState> = {};
      switch (localState.position) {
        case 'floating':
        case 'right':
          updates.rightSize = { width: size.width, height: localState.rightSize.height };
          break;
        case 'bottom':
          updates.bottomSize = { width: localState.bottomSize.width, height: size.height };
          break;
      }
      store.updateState(panelId, updates);
    },
    [panelId, localState.position, localState.rightSize.height, localState.bottomSize.width, store]
  );

  const setOpen = useCallback(
    (isOpen: boolean) => {
      store.setPanelOpenById(panelId, isOpen);
    },
    [panelId, store]
  );

  const setMaximized = useCallback(
    (isMaximized: boolean) => {
      store.updateState(panelId, { isMaximized });
    },
    [panelId, store]
  );

  const toggle = useCallback(() => {
    setOpen(!localState.isOpen);
  }, [localState.isOpen, setOpen]);

  const focus = useCallback(() => {
    store.focusPanelById(panelId);
  }, [panelId, store]);

  const reset = useCallback(() => {
    store.updateState(panelId, {
      position: 'right',
      rightSize: { width: 400, height: 300 },
      bottomSize: { width: 400, height: 300 },
      isMaximized: false,
      isOpen: false,
      isInitialized: false,
      zIndex: localState.zIndex + 1,
    });
  }, [panelId, localState.zIndex, store]);

  return useMemo(
    () => ({
      position: localState.position,
      size: localState.position === 'bottom' ? localState.bottomSize : localState.rightSize,
      rightSize: localState.rightSize,
      bottomSize: localState.bottomSize,
      isMaximized: localState.isMaximized,
      isOpen: localState.isOpen,
      isInitialized: localState.isInitialized,
      zIndex: localState.zIndex,
      initialize,
      setPosition,
      setSize,
      setOpen,
      setMaximized,
      toggle,
      focus,
      reset,
    }),
    [localState, initialize, setPosition, setSize, setOpen, setMaximized, toggle, focus, reset]
  );
}

export function getAllPanelStates(): Record<string, PanelLayoutState> {
  return getActivePanelLayoutStore().getAllPanelStates();
}

export function restorePanelStates(states: Record<string, PanelLayoutState>) {
  getActivePanelLayoutStore().restorePanelStates(states);
}
