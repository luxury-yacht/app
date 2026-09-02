import type { panelwindow } from '@/core/backend-api/models';
import type { TabDragPayload } from '@/shared/components/tabs/dragCoordinator';

export type DockableTabDragPayload = Extract<TabDragPayload, { kind: 'dockable-tab' }>;

export const objectPanelTabSnapshot = (
  panelId: string,
  objectRef: {
    clusterId: string;
    group: string;
    version: string;
    kind: string;
    namespace?: string;
    name: string;
  },
  activeView: string
): panelwindow.TabSnapshot => ({
  kind: 'object' as panelwindow.TabKind,
  panelId,
  objectRef: {
    clusterId: objectRef.clusterId,
    group: objectRef.group,
    version: objectRef.version,
    kind: objectRef.kind,
    namespace: objectRef.namespace ?? '',
    name: objectRef.name,
  },
  activeView,
});

export const singleTabGroupSnapshot = (
  request: panelwindow.TabTransferRequest
): panelwindow.GroupSnapshot => ({
  schemaVersion: 1,
  transferId: request.transferId,
  ownerWindowName: request.ownerWindowName,
  clusterId: request.clusterId,
  groupId: request.targetGroupId,
  tabs: [request.tab],
  activePanelId: request.tab.panelId,
});

export const tabTransferRequestFromDragPayload = (
  payload: DockableTabDragPayload,
  target: {
    transferId: string;
    targetWindowName: string;
    targetGroupId: string;
    targetIndex: number;
    targetKind: panelwindow.TabTransferTarget;
    cursor?: { x: number; y: number };
  }
): panelwindow.TabTransferRequest | null => {
  if (!payload.sourceWindowName || !payload.ownerWindowName || !payload.clusterId || !payload.tab) {
    return null;
  }
  return {
    transferId: target.transferId,
    sourceWindowName: payload.sourceWindowName,
    targetWindowName: target.targetWindowName,
    ownerWindowName: payload.ownerWindowName,
    clusterId: payload.clusterId,
    sourceGroupId: payload.sourceWindowGroupId ?? payload.sourceGroupId,
    targetGroupId: target.targetGroupId,
    targetIndex: target.targetIndex,
    targetKind: target.targetKind,
    cursorX: Math.round(target.cursor?.x ?? 0),
    cursorY: Math.round(target.cursor?.y ?? 0),
    tab: payload.tab as panelwindow.TabSnapshot,
  };
};
