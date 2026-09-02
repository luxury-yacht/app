import type { DockPosition } from '@/ui/dockable';
import type { GroupKey } from '@/ui/dockable/tabGroupTypes';

export interface ObjectPanelOpenTarget {
  groupKey: GroupKey | 'floating';
  position: DockPosition;
}

export const resolveObjectPanelOpenTarget = (
  requestedPosition: DockPosition,
  defaultGroupKey: GroupKey | 'floating' | undefined,
  getPreferredOpenGroupKey: (position: DockPosition) => GroupKey | 'floating'
): ObjectPanelOpenTarget => {
  const groupKey =
    defaultGroupKey ??
    (requestedPosition === 'floating' ? 'floating' : getPreferredOpenGroupKey(requestedPosition));
  return {
    groupKey,
    position: groupKey === 'right' || groupKey === 'bottom' ? groupKey : requestedPosition,
  };
};
