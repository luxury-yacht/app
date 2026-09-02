import type { DockPosition } from '@ui/dockable';
import type { GroupKey } from '@ui/dockable/tabGroupTypes';

export interface ObjectPanelMountTarget {
  position: DockPosition;
  groupKey: GroupKey | undefined;
}

export const resolveObjectPanelMountTarget = (
  dockedEdge: 'right' | 'bottom' | undefined,
  defaultPosition: DockPosition
): ObjectPanelMountTarget => ({
  position: dockedEdge ?? defaultPosition,
  groupKey: dockedEdge,
});
