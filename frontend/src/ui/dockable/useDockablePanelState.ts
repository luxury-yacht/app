/**
 * useDockablePanelState.ts
 *
 * Reads panel geometry from the owning layout store and placement from its groups.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { DockPosition, PanelLayoutState } from './panelLayoutStore';
import { usePanelLayoutStoreContext } from './panelLayoutStoreContext';
import { addPanelToGroup, getPanelPosition } from './tabGroupState';

interface InitializeOptions {
  size?: { width?: number; height?: number };
  isOpen?: boolean;
}

export type { DockPosition };

export function useDockablePanelState(panelId: string, defaultPosition: DockPosition = 'right') {
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
  const groups = useSyncExternalStore(store.subscribeTabGroups, store.getTabGroups);
  const position = getPanelPosition(groups, panelId) ?? defaultPosition;

  const initialize = useCallback(
    (options: InitializeOptions) => {
      if (localState.isInitialized) {
        return;
      }
      const defaultSize = options.size || {};
      const finalIsOpen = options.isOpen ?? localState.isOpen;

      // Only apply defaultSize when the store used generic fallback values.
      // Object panels have user-configured sizes set by getInitialState —
      // those should not be overwritten by PANEL_DEFAULTS from DockablePanel.
      const isObjectPanel = panelId.startsWith('obj:');
      store.updateState(panelId, {
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
    (nextPosition: DockPosition) => {
      store.setTabGroups((currentGroups) =>
        getPanelPosition(currentGroups, panelId) === nextPosition
          ? currentGroups
          : addPanelToGroup(currentGroups, panelId, nextPosition)
      );
    },
    [panelId, store]
  );

  const setSize = useCallback(
    (size: { width: number; height: number }) => {
      const updates: Partial<PanelLayoutState> = {};
      switch (position) {
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
    [panelId, position, localState.rightSize.height, localState.bottomSize.width, store]
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
    setPosition('right');
    store.updateState(panelId, {
      rightSize: { width: 400, height: 300 },
      bottomSize: { width: 400, height: 300 },
      isMaximized: false,
      isOpen: false,
      isInitialized: false,
      zIndex: localState.zIndex + 1,
    });
  }, [panelId, localState.zIndex, store, setPosition]);

  return useMemo(
    () => ({
      position,
      size: position === 'bottom' ? localState.bottomSize : localState.rightSize,
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
      position,
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
