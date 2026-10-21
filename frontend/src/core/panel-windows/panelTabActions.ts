import type { panelwindow } from '@/core/backend-api/models';
import type { DockPosition } from '@/ui/dockable/useDockablePanelState';
import { requestPanelTabTransfer } from './index';
import { type DockableTabDragPayload, tabTransferRequestFromDragPayload } from './tabTransfer';

// The directory checks the tab's identity, not its published view, so the move
// need not wait for this renderer's queued publication.
export async function requestPanelTabMove(
  payload: DockableTabDragPayload,
  target: DockPosition,
  dockWindowName: string
): Promise<void> {
  const request = tabTransferRequestFromDragPayload(payload, {
    transferId: globalThis.crypto.randomUUID(),
    targetWindowName: target === 'floating' ? '' : dockWindowName,
    targetGroupId: target === 'floating' ? globalThis.crypto.randomUUID() : target,
    targetIndex: 0,
    targetKind: (target === 'floating'
      ? 'new-window'
      : 'workspace') as panelwindow.TabTransferTarget,
  });
  if (!request) {
    throw new Error('Panel tab move requires complete source and object identity');
  }
  await requestPanelTabTransfer(request.sourceWindowName, request);
}
