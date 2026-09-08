import type { panelwindow } from '@/core/backend-api/models';
import { getObjectPanelLayoutDefaults } from '@/core/settings/appPreferences';
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
  sourceWindowName: request.sourceWindowName,
  clusterId: request.clusterId,
  groupId: request.targetGroupId,
  tabs: [request.tab],
  activePanelId: request.tab.panelId,
});

export const tornOffTabSnapshot = (
  request: panelwindow.TabTransferRequest,
  initialBounds?: panelwindow.WindowBounds
): panelwindow.GroupSnapshot => {
  const snapshot = singleTabGroupSnapshot(request);
  const { floatingWidth: width, floatingHeight: height } = getObjectPanelLayoutDefaults();
  snapshot.initialBounds = initialBounds ?? { x: 0, y: 0, width, height };
  if (request.cursorX !== 0 || request.cursorY !== 0) {
    snapshot.initialBounds.x = request.cursorX - 120;
    snapshot.initialBounds.y = request.cursorY - 24;
    snapshot.initialPositionAnchor = { x: request.cursorX, y: request.cursorY };
    snapshot.useInitialPosition = true;
  }
  return snapshot;
};

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
  if (!payload.sourceWindowName || !payload.clusterId || !payload.tab) {
    return null;
  }
  return {
    transferId: target.transferId,
    sourceWindowName: payload.sourceWindowName,
    targetWindowName: target.targetWindowName,
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

export function samePanelTab(
  left: panelwindow.TabSnapshot | null,
  right: panelwindow.TabSnapshot
): boolean {
  if (
    left?.kind !== right.kind ||
    left.panelId !== right.panelId ||
    left.activeView !== right.activeView
  ) {
    return false;
  }
  const a = left.objectRef,
    b = right.objectRef;
  return (
    a.clusterId === b.clusterId &&
    a.group === b.group &&
    a.version === b.version &&
    a.kind === b.kind &&
    a.namespace === b.namespace &&
    a.name === b.name
  );
}
