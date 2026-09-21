import { useCallback, useSyncExternalStore } from 'react';
import type { DockPosition } from './panelLayoutStore';
import { usePanelLayoutStoreContext } from './panelLayoutStoreContext';

export function useDockableGroupState(groupKey: string, isOpen: boolean) {
  const store = usePanelLayoutStoreContext();
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeGroupLayout(groupKey, listener),
    [store, groupKey]
  );
  const snapshot = useCallback(() => store.getGroupLayout(groupKey), [store, groupKey]);
  const layout = useSyncExternalStore(subscribe, snapshot);
  const position: DockPosition =
    groupKey === 'right' || groupKey === 'bottom' ? groupKey : 'floating';
  const setSize = useCallback(
    (size: { width: number; height: number }) => {
      const current = store.getGroupLayout(groupKey);
      store.updateGroupLayout(
        groupKey,
        position === 'bottom'
          ? { bottomSize: { ...current.bottomSize, height: size.height } }
          : { rightSize: { ...current.rightSize, width: size.width } }
      );
    },
    [store, groupKey, position]
  );
  const setMaximized = useCallback(
    (isMaximized: boolean) => store.updateGroupLayout(groupKey, { isMaximized }),
    [store, groupKey]
  );
  const focus = useCallback(() => store.focusGroup(groupKey), [store, groupKey]);
  return {
    ...layout,
    position,
    isOpen,
    size: position === 'bottom' ? layout.bottomSize : layout.rightSize,
    setSize,
    setMaximized,
    focus,
  };
}
