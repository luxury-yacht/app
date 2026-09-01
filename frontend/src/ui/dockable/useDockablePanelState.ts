/**
 * useDockablePanelState.ts
 *
 * Hook and compatibility exports for dockable panel runtime state.
 * Runtime storage is delegated to the active panel layout store.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DockPosition,
  getActivePanelLayoutStore,
  type PanelCloseReason,
  type PanelLayoutState,
} from './panelLayoutStore';
import { usePanelLayoutStoreContext } from './panelLayoutStoreContext';

interface InitializeOptions {
  position?: DockPosition;
  size?: { width?: number; height?: number };
  isOpen?: boolean;
}

export type { DockPosition, PanelCloseReason };

/**
 * Bring a panel to the front by bumping its z-index.
 * Used by provider-level focus actions.
 */
export function focusPanelById(panelId: string) {
  getActivePanelLayoutStore().focusPanelById(panelId);
}

/**
 * Set a panel's dock position by ID.
 */
export function setPanelPositionById(panelId: string, position: DockPosition) {
  getActivePanelLayoutStore().setPanelPositionById(panelId, position);
}

/**
 * Set a panel's open state by ID.
 */
export function setPanelOpenById(panelId: string, isOpen: boolean) {
  getActivePanelLayoutStore().setPanelOpenById(panelId, isOpen);
}

/**
 * Copy layout-related fields from one panel to another.
 */
export function copyPanelLayoutState(sourcePanelId: string, targetPanelId: string) {
  getActivePanelLayoutStore().copyPanelLayoutState(sourcePanelId, targetPanelId);
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

export function setGroupLeader(groupKey: string, panelId: string) {
  getActivePanelLayoutStore().setGroupLeader(groupKey, panelId);
}

export function clearGroupLeader(groupKey: string) {
  getActivePanelLayoutStore().clearGroupLeader(groupKey);
}

export function registerPanelCloseHandler(
  panelId: string,
  handler: (reason: PanelCloseReason) => void
) {
  getActivePanelLayoutStore().registerPanelCloseHandler(panelId, handler);
}

export function unregisterPanelCloseHandler(
  panelId: string,
  handler: (reason: PanelCloseReason) => void
) {
  getActivePanelLayoutStore().unregisterPanelCloseHandler(panelId, handler);
}

export function useDockablePanelState(panelId: string) {
  const store = usePanelLayoutStoreContext();
  const [localState, setLocalState] = useState<PanelLayoutState>(() =>
    store.getInitialState(panelId)
  );

  useEffect(() => {
    setLocalState(store.getInitialState(panelId));

    const unsubscribe = store.subscribe(panelId, () => {
      const newState = store.getState(panelId);
      if (!newState) {
        return;
      }
      setLocalState((prevState) => {
        const hasChanged =
          prevState.position !== newState.position ||
          prevState.isMaximized !== newState.isMaximized ||
          prevState.isOpen !== newState.isOpen ||
          prevState.rightSize.width !== newState.rightSize.width ||
          prevState.rightSize.height !== newState.rightSize.height ||
          prevState.bottomSize.width !== newState.bottomSize.width ||
          prevState.bottomSize.height !== newState.bottomSize.height ||
          prevState.isInitialized !== newState.isInitialized ||
          prevState.zIndex !== newState.zIndex;

        if (hasChanged) {
          return { ...newState };
        }
        return prevState;
      });
    });

    return unsubscribe;
  }, [panelId, store]);

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
          updates.rightSize = { width: size.width, height: localState.rightSize.height };
          break;
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

  const getCurrentSize = useCallback(() => {
    switch (localState.position) {
      case 'floating':
        return localState.rightSize;
      case 'right':
        return localState.rightSize;
      case 'bottom':
        return localState.bottomSize;
      default:
        return localState.rightSize;
    }
  }, [localState.position, localState.rightSize, localState.bottomSize]);

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
      size: getCurrentSize(),
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
    [
      localState,
      getCurrentSize,
      initialize,
      setPosition,
      setSize,
      setOpen,
      setMaximized,
      toggle,
      focus,
      reset,
    ]
  );
}

export function getAllPanelStates(): Record<string, PanelLayoutState> {
  return getActivePanelLayoutStore().getAllPanelStates();
}

export function restorePanelStates(states: Record<string, PanelLayoutState>) {
  getActivePanelLayoutStore().restorePanelStates(states);
}
