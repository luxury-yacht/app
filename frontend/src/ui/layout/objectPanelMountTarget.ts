import type { DockPosition } from '@ui/dockable';
import type { GroupKey } from '@ui/dockable/tabGroupTypes';

export interface ObjectPanelMountTarget {
  position: DockPosition;
  groupKey: GroupKey | undefined;
}

export const resolveObjectPanelMountTarget = (
  groupKey: GroupKey | null | undefined,
  defaultPosition: DockPosition,
  pendingNativePanelId?: string
): ObjectPanelMountTarget => {
  let position = defaultPosition;
  if (groupKey) {
    position = groupKey === 'right' || groupKey === 'bottom' ? groupKey : 'floating';
  }
  return {
    position,
    groupKey:
      groupKey ??
      (defaultPosition === 'floating' && pendingNativePanelId
        ? `pending-native:${pendingNativePanelId}`
        : undefined),
  };
};
