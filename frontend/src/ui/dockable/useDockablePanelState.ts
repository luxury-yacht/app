/** Observe a tab's lifetime and derive its placement from group membership. */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { DockPosition } from './panelLayoutStore';
import { usePanelLayoutStoreContext } from './panelLayoutStoreContext';
import { getPanelPosition } from './tabGroupState';

export type { DockPosition };

export function useDockablePanelState(panelId: string, defaultPosition: DockPosition = 'right') {
  const store = usePanelLayoutStoreContext();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(panelId, listener),
    [panelId, store]
  );
  // Committed removal may evict state before the component unmounts. Preserve
  // the observer's last state so it cannot initialize and reopen that tab.
  const snapshot = useMemo(() => {
    let last = store.getInitialState(panelId);
    return () => {
      last = store.getState(panelId) ?? last;
      return last;
    };
  }, [store, panelId]);
  const tab = useSyncExternalStore(subscribe, snapshot);
  const groups = useSyncExternalStore(store.subscribeTabGroups, store.getTabGroups);
  const position = getPanelPosition(groups, panelId) ?? defaultPosition;
  const initialize = useCallback(
    (options: { isOpen?: boolean }) => {
      if (!tab.isInitialized) {
        store.updateState(panelId, { isInitialized: true, isOpen: options.isOpen ?? tab.isOpen });
      }
    },
    [store, panelId, tab]
  );
  const setOpen = useCallback(
    (isOpen: boolean) => store.setPanelOpenById(panelId, isOpen),
    [store, panelId]
  );
  return { ...tab, position, initialize, setOpen };
}
