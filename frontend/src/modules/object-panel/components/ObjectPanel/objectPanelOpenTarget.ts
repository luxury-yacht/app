import type { DockPosition } from '@/ui/dockable';
import type { GroupKey } from '@/ui/dockable/tabGroupTypes';

export interface ObjectPanelOpenTarget {
  groupKey: GroupKey;
  position: DockPosition;
}

export const resolveObjectPanelOpenTarget = (
  requestedPosition: DockPosition,
  defaultGroupKey: GroupKey | undefined,
  getPreferredOpenGroupKey: (position: DockPosition) => GroupKey
): ObjectPanelOpenTarget => {
  const groupKey =
    defaultGroupKey ??
    (requestedPosition === 'floating' ? 'floating' : getPreferredOpenGroupKey(requestedPosition));
  return {
    groupKey,
    position: groupKey === 'right' || groupKey === 'bottom' ? groupKey : requestedPosition,
  };
};
