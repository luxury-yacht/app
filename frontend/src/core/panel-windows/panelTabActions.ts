import type { panelwindow } from '@/core/backend-api/models';
import type { DockPosition } from '@/ui/dockable/useDockablePanelState';
import { requestPanelTabTransfer } from './index';
import { type DockableTabDragPayload, tabTransferRequestFromDragPayload } from './tabTransfer';

export async function requestPanelTabMove(
  payload: DockableTabDragPayload,
  target: DockPosition,
  publication: { flush: () => Promise<void> },
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
  await publication.flush();
  await requestPanelTabTransfer(request.sourceWindowName, request);
}
