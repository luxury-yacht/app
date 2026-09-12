import { tabReorderMenuItems } from '@shared/components/tabs/tabReorderMenuItems';
import ContextMenu, { type ContextMenuItem } from '@/shared/components/ContextMenu';
import {
  DockBottomIcon,
  DockRightIcon,
  FloatPanelIcon,
} from '@/shared/components/icons/DockableIcons';
import { CloseIcon } from '@/shared/components/icons/SharedIcons';
import { useDockablePanelContext } from './DockablePanelProvider';
import { getGroupTabs } from './tabGroupState';
import type { DockPosition } from './useDockablePanelState';

export function DockableTabMenu({
  panelId,
  groupKey,
  position,
  onClose,
}: Readonly<{
  panelId: string;
  groupKey: string;
  position: { x: number; y: number };
  onClose: () => void;
}>) {
  const { requestTabMove, closeTab, nativeWindowMode, tabGroups, reorderTabInGroup } =
    useDockablePanelContext();
  const ids = getGroupTabs(tabGroups, groupKey)?.tabs ?? [];
  const orderActions = tabReorderMenuItems(ids, panelId, (index) =>
    reorderTabInGroup(groupKey, panelId, index)
  );
  const items: ContextMenuItem[] = [];
  const addMove = (label: string, target: DockPosition, icon: ContextMenuItem['icon']) => {
    items.push({ label, icon, onClick: () => requestTabMove(panelId, target) });
  };
  if (nativeWindowMode || groupKey !== 'right') {
    addMove('Dock to right', 'right', <DockRightIcon width={16} height={16} />);
  }
  if (nativeWindowMode || groupKey !== 'bottom') {
    addMove('Dock to bottom', 'bottom', <DockBottomIcon width={16} height={16} />);
  }
  if (!nativeWindowMode) {
    addMove('Float', 'floating', <FloatPanelIcon width={16} height={16} />);
  }
  items.push(
    { divider: true },
    {
      label: 'Close',
      icon: <CloseIcon width={16} height={16} />,
      onClick: () => closeTab(panelId),
    },
    ...(orderActions.length ? [{ divider: true }, ...orderActions] : [])
  );
  return <ContextMenu items={items} position={position} onClose={onClose} />;
}
