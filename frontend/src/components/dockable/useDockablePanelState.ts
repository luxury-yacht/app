/**
 * useDockablePanelState.ts
 *
 * Hook and compatibility exports for dockable panel runtime state.
 * Runtime storage is delegated to the active panel layout store.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  getActivePanelLayoutStore,
  type DockPosition,
  type PanelCloseReason,
  type PanelLayoutState,
} from './panelLayoutStore';
import { getContentBounds } from './dockablePanelLayout';

interface InitializeOptions {
  position?: DockPosition;
  size?: { width?: number; height?: number };
  floatingPosition?: { x?: number; y?: number };
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
 * Set a panel's floating position by ID.
 */
export function setPanelFloatingPositionById(panelId: string, position: { x: number; y: number }) {
  getActivePanelLayoutStore().setPanelFloatingPositionById(panelId, position);
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
  const [localState, setLocalState] = useState<PanelLayoutState>(() =>
    getActivePanelLayoutStore().getInitialState(panelId)
  );

  useEffect(() => {
    const store = getActivePanelLayoutStore();
    setLocalState(store.getInitialState(panelId));

    const unsubscribe = store.subscribe(panelId, () => {
      const newState = store.getState(panelId);
      if (!newState) {
        return;
      }
      setLocalState((prevState) => {
        const hasChanged =
          prevState.position !== newState.position ||
          prevState.isOpen !== newState.isOpen ||
          prevState.floatingSize.width !== newState.floatingSize.width ||
          prevState.floatingSize.height !== newState.floatingSize.height ||
          prevState.rightSize.width !== newState.rightSize.width ||
          prevState.rightSize.height !== newState.rightSize.height ||
          prevState.bottomSize.width !== newState.bottomSize.width ||
          prevState.bottomSize.height !== newState.bottomSize.height ||
          prevState.floatingPosition.x !== newState.floatingPosition.x ||
          prevState.floatingPosition.y !== newState.floatingPosition.y ||
          prevState.isInitialized !== newState.isInitialized ||
          prevState.zIndex !== newState.zIndex;

        if (hasChanged) {
          return { ...newState };
        }
        return prevState;
      });
    });

    return unsubscribe;
  }, [panelId]);

  const initialize = useCallback(
    (options: InitializeOptions) => {
      if (localState.isInitialized) {
        return;
      }
      const defaultSize = options.size || {};
      const finalIsOpen = options.isOpen ?? localState.isOpen;
      const targetPosition = options.position ?? localState.position;

      getActivePanelLayoutStore().updateState(panelId, {
        position: targetPosition,
        floatingSize: {
          width: defaultSize.width ?? localState.floatingSize.width,
          height: defaultSize.height ?? localState.floatingSize.height,
        },
        rightSize: {
          width: defaultSize.width ?? localState.rightSize.width,
          height: localState.rightSize.height,
        },
        bottomSize: {
          width: localState.bottomSize.width,
          height: defaultSize.height ?? localState.bottomSize.height,
        },
        floatingPosition: {
          x: options.floatingPosition?.x ?? localState.floatingPosition.x,
          y: options.floatingPosition?.y ?? localState.floatingPosition.y,
        },
        isOpen: finalIsOpen,
        isInitialized: true,
      });
    },
    [panelId, localState]
  );

  const setPosition = useCallback(
    (position: DockPosition) => {
      getActivePanelLayoutStore().setPanelPositionById(panelId, position);
    },
    [panelId]
  );

  const setSize = useCallback(
    (size: { width: number; height: number }) => {
      const updates: Partial<PanelLayoutState> = {};
      switch (localState.position) {
        case 'floating':
          updates.floatingSize = size;
          break;
        case 'right':
          updates.rightSize = { width: size.width, height: localState.rightSize.height };
          break;
        case 'bottom':
          updates.bottomSize = { width: localState.bottomSize.width, height: size.height };
          break;
      }
      getActivePanelLayoutStore().updateState(panelId, updates);
    },
    [panelId, localState.position, localState.rightSize.height, localState.bottomSize.width]
  );

  const getCurrentSize = useCallback(() => {
    switch (localState.position) {
      case 'floating':
        return localState.floatingSize;
      case 'right':
        return localState.rightSize;
      case 'bottom':
        return localState.bottomSize;
      default:
        return localState.floatingSize;
    }
  }, [localState.position, localState.floatingSize, localState.rightSize, localState.bottomSize]);

  const setFloatingPosition = useCallback(
    (position: { x: number; y: number }) => {
      getActivePanelLayoutStore().setPanelFloatingPositionById(panelId, position);
    },
    [panelId]
  );

  const setOpen = useCallback(
    (isOpen: boolean) => {
      getActivePanelLayoutStore().setPanelOpenById(panelId, isOpen);
    },
    [panelId]
  );

  const toggle = useCallback(() => {
    setOpen(!localState.isOpen);
  }, [localState.isOpen, setOpen]);

  const focus = useCallback(() => {
    getActivePanelLayoutStore().focusPanelById(panelId);
  }, [panelId]);

  const reset = useCallback(() => {
    const defaultFloatingWidth = 600;
    const defaultFloatingHeight = 400;
    const content = getContentBounds();
    const centerX = Math.max(100, (content.width - defaultFloatingWidth) / 2);
    const centerY = Math.max(100, (content.height - defaultFloatingHeight) / 2);

    getActivePanelLayoutStore().updateState(panelId, {
      position: 'right',
      floatingSize: { width: defaultFloatingWidth, height: defaultFloatingHeight },
      rightSize: { width: 400, height: 300 },
      bottomSize: { width: 400, height: 300 },
      floatingPosition: { x: centerX, y: centerY },
      isOpen: false,
      isInitialized: false,
      zIndex: localState.zIndex + 1,
    });
  }, [panelId, localState.zIndex]);

  return useMemo(
    () => ({
      position: localState.position,
      size: getCurrentSize(),
      floatingSize: localState.floatingSize,
      rightSize: localState.rightSize,
      bottomSize: localState.bottomSize,
      floatingPosition: localState.floatingPosition,
      isOpen: localState.isOpen,
      isInitialized: localState.isInitialized,
      zIndex: localState.zIndex,
      initialize,
      setPosition,
      setSize,
      setFloatingPosition,
      setOpen,
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
      setFloatingPosition,
      setOpen,
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
