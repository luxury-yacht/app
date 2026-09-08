import ContextMenu, { type ContextMenuItem } from '@/shared/components/ContextMenu';
import { useDockablePanelContext } from './DockablePanelProvider';
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
  const { requestTabMove, closeTab, nativeWindowMode } = useDockablePanelContext();
  const items: ContextMenuItem[] = [];
  const addMove = (label: string, target: DockPosition) => {
    items.push({ label, onClick: () => requestTabMove(panelId, target) });
  };
  if (nativeWindowMode || groupKey !== 'right') {
    addMove('Dock to right', 'right');
  }
  if (nativeWindowMode || groupKey !== 'bottom') {
    addMove('Dock to bottom', 'bottom');
  }
  if (!nativeWindowMode) {
    addMove('Float', 'floating');
  }
  items.push({ divider: true }, { label: 'Close', onClick: () => closeTab(panelId) });
  return <ContextMenu items={items} position={position} onClose={onClose} />;
}
