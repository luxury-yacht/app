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
): ObjectPanelMountTarget => ({
  position: groupKey
    ? groupKey === 'right' || groupKey === 'bottom'
      ? groupKey
      : 'floating'
    : defaultPosition,
  groupKey:
    groupKey ??
    (defaultPosition === 'floating' && pendingNativePanelId
      ? `pending-native:${pendingNativePanelId}`
      : undefined),
});
