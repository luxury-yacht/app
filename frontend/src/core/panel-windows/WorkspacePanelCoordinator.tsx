import { panelTargetFromSnapshot, panelTargetId } from '@modules/object-panel/panelTarget';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { getObjectPanelLayoutDefaults } from '@/core/settings/appPreferences';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import {
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import type { DockPosition } from '@/ui/dockable';
import { DockablePanelProvider, useDockablePanelContext } from '@/ui/dockable';
import { getGroupForPanel } from '@/ui/dockable/tabGroupState';
import type { GroupKey } from '@/ui/dockable/tabGroupTypes';
import { reportOperationalError } from '@/utils/errorHandler';
import { ClusterTabTransferCoordinator } from './ClusterTabTransferCoordinator';
import { canMoveClusterToNewWindow } from './clusterTabTransferPolicy';
import {
  acceptPanelTabTransfer,
  acknowledgePanelWindowDock,
  beginPanelWindowOpen,
  failPanelTabTransfer,
  failPanelWindowTransfer,
  onPanelTabTransferCommitted,
  onPanelTabTransferFailed,
  onPanelTabTransferInsertRequested,
  onPanelTabTransferRequested,
  onPanelWindowClosed,
  onPanelWindowOpened,
  onPanelWorkspaceFocusRequested,
  requestClusterTabTransfer,
  requestPanelTabTransfer,
} from './index';
import { usePanelLifecycleGuardRegistry } from './panelLifecycleGuards';
import { requestPanelTabMove } from './panelTabActions';
import { workspacePanelPublication } from './publicationQueue';
import {
  type DockableTabDragPayload,
  objectPanelTabSnapshot,
  singleTabGroupSnapshot,
  tabTransferRequestFromDragPayload,
  tornOffTabSnapshot,
} from './tabTransfer';
import { useRemoveWorkspacePanels } from './useRemoveWorkspacePanels';
import { useRestoreWorkspacePanels } from './useRestoreWorkspacePanels';

const newIdentity = (prefix: string): string =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;

const initialWindowBounds = (panelIds: readonly string[]): panelwindow.WindowBounds | undefined => {
  if (panelIds.length === 0) {
    return undefined;
  }
  const { floatingWidth: width, floatingHeight: height } = getObjectPanelLayoutDefaults();
  return {
    x: 0,
    y: 0,
    width,
    height,
  };
};

type OwnedPanel = NonNullable<ReturnType<ReturnType<typeof useObjectPanelState>['getOwnedPanel']>>;

const sameTransferredTab = (owned: OwnedPanel, tab: panelwindow.TabSnapshot): boolean =>
  panelTargetId(owned.objectRef) === panelTargetId(panelTargetFromSnapshot(tab)) &&
  owned.activeView === tab.activeView;

const isAuthoritativeTransferSource = (
  request: panelwindow.TabTransferRequest,
  owned: OwnedPanel | null,
  sourceGroup: GroupKey | null,
  windowName: string
): boolean => {
  if (!owned || !sameTransferredTab(owned, request.tab)) {
    return false;
  }
  return request.sourceWindowName === windowName && sourceGroup === request.sourceGroupId;
};

import { WorkspacePanelLifecycle } from './WorkspacePanelLifecycle';
import {
  type IncomingGroupTransfer,
  useIncomingGroupTransfers,
  usePanelWorkspaceSync,
  WorkspacePanelSync,
} from './WorkspacePanelSync';
export function WorkspacePanelCoordinator({ children }: Readonly<{ children: React.ReactNode }>) {
  const windowName = getWindowIdentity();
  const { openPanels, pendingNativeOpenPanelIds, removeOwnedPanel } = useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  const guards = usePanelLifecycleGuardRegistry();
  const pendingFloatGroupIdsRef = useRef(
    new Map<
      string,
      { sourceGroup: GroupKey; snapshot: panelwindow.GroupSnapshot; autoFloat: boolean }
    >()
  );
  const [pendingAutoFloatRollbacks, setPendingAutoFloatRollbacks] = useState<
    panelwindow.GroupSnapshot[]
  >([]);
  const queueAutoFloatRollback = useCallback((snapshot: panelwindow.GroupSnapshot) => {
    setPendingAutoFloatRollbacks((current) => [...current, snapshot]);
  }, []);
  const handleGroupMove = useCallback(
    (
      group: { groupKey: GroupKey; tabs: string[]; activeTab: string | null },
      targetPosition: DockPosition
    ): boolean => {
      if (targetPosition !== 'floating') {
        return false;
      }
      if (
        Array.from(pendingFloatGroupIdsRef.current.values()).some(
          (pending) => pending.sourceGroup === group.groupKey
        )
      ) {
        return true;
      }
      const blocker = guards.firstBlocker(group.tabs);
      if (blocker) {
        blocker.focus();
        return true;
      }
      const firstRef = openPanels.get(group.tabs[0] ?? '');
      if (!firstRef?.clusterId) {
        return true;
      }
      const groupId = newIdentity('panel-group');
      const snapshot: panelwindow.GroupSnapshot = {
        schemaVersion: 1,
        transferId: newIdentity('panel-transfer'),
        sourceWindowName: windowName,
        clusterId: firstRef.clusterId,
        groupId,
        tabs: group.tabs.flatMap((panelId) => {
          const objectRef = openPanels.get(panelId);
          if (!objectRef || objectRef.clusterId !== firstRef.clusterId) {
            return [];
          }
          return [objectPanelTabSnapshot(panelId, objectRef, activeTabs.get(panelId) ?? 'details')];
        }),
        activePanelId: group.activeTab ?? group.tabs[0] ?? '',
        initialBounds: initialWindowBounds(group.tabs),
      };
      const autoFloat =
        group.tabs.length > 0 &&
        group.tabs.every((panelId) => pendingNativeOpenPanelIds.has(panelId));
      pendingFloatGroupIdsRef.current.set(groupId, {
        sourceGroup: group.groupKey,
        snapshot,
        autoFloat,
      });
      guards.freeze(snapshot.transferId, group.tabs);
      // The directory validates the group against its own placement, so a
      // queued docked publication need not land first.
      void beginPanelWindowOpen(windowName, snapshot).catch((error) => {
        guards.releaseTransfer(snapshot.transferId);
        const pending = pendingFloatGroupIdsRef.current.get(groupId);
        pendingFloatGroupIdsRef.current.delete(groupId);
        if (pending?.autoFloat) {
          queueAutoFloatRollback(pending.snapshot);
        }
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'float-group',
        });
      });
      return true;
    },
    [activeTabs, guards, openPanels, windowName, pendingNativeOpenPanelIds, queueAutoFloatRollback]
  );

  const getTabSnapshot = useCallback(
    (panelId: string) => {
      const objectRef = openPanels.get(panelId);
      return objectRef
        ? objectPanelTabSnapshot(panelId, objectRef, activeTabs.get(panelId) ?? 'details')
        : undefined;
    },
    [activeTabs, openPanels]
  );

  // Only object panels can be packaged into a native window (see handleGroupMove).
  const canFloatPanel = useCallback(
    (panelId: string) => Boolean(openPanels.get(panelId)?.clusterId),
    [openPanels]
  );

  const tabDragIdentity = useMemo(
    () => ({
      windowName,
      clusterId: selectedClusterId,
      getTabSnapshot,
    }),
    [getTabSnapshot, windowName, selectedClusterId]
  );

  const canStartTabDrag = useCallback(
    (panelId: string) => {
      const blocker = guards.firstBlocker([panelId]);
      blocker?.focus();
      return blocker === null;
    },
    [guards]
  );

  const handleExternalTabDrop = useCallback(
    (payload: DockableTabDragPayload, targetGroupId: string, insertIndex: number) => {
      if (targetGroupId !== 'right' && targetGroupId !== 'bottom') {
        return;
      }
      const request = tabTransferRequestFromDragPayload(payload, {
        transferId: newIdentity('panel-tab-transfer'),
        targetWindowName: windowName,
        targetGroupId,
        targetIndex: insertIndex,
        targetKind: 'workspace' as panelwindow.TabTransferTarget,
      });
      if (!request) {
        return;
      }
      void requestPanelTabTransfer(windowName, request).catch((error) =>
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'request-tab-drop',
          clusterId: request.clusterId,
        })
      );
    },
    [windowName]
  );

  const handleTabTearOff = useCallback(
    (payload: DockableTabDragPayload, cursor: { x: number; y: number }) => {
      const request = tabTransferRequestFromDragPayload(payload, {
        transferId: newIdentity('panel-tab-transfer'),
        targetWindowName: '',
        targetGroupId: newIdentity('panel-group'),
        targetIndex: 0,
        targetKind: 'new-window' as panelwindow.TabTransferTarget,
        cursor,
      });
      if (request?.sourceWindowName !== windowName) {
        return;
      }
      void requestPanelTabTransfer(windowName, request).catch((error) =>
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'tear-off-tab',
          clusterId: request.clusterId,
        })
      );
    },
    [windowName]
  );

  const handlePanelWindowOpened = useCallback(
    (event: panelwindow.WindowOpenedEvent) => {
      pendingFloatGroupIdsRef.current.delete(event.groupId);
      for (const tab of event.snapshot.tabs ?? []) {
        removeOwnedPanel(event.clusterId, tab.panelId);
      }
      guards.releaseTransfer(event.snapshot.transferId);
    },
    [removeOwnedPanel, guards.releaseTransfer]
  );
  const handlePanelWindowClosed = useCallback(
    (_windowName: string, groupId?: string) => {
      const pending = groupId ? pendingFloatGroupIdsRef.current.get(groupId) : undefined;
      if (!pending || !groupId) {
        return;
      }
      guards.releaseTransfer(pending.snapshot.transferId);
      pendingFloatGroupIdsRef.current.delete(groupId);
      if (pending.autoFloat) {
        queueAutoFloatRollback(pending.snapshot);
      }
    },
    [queueAutoFloatRollback, guards.releaseTransfer]
  );
  const handleAutoFloatRollbackSettled = useCallback((transferId: string) => {
    setPendingAutoFloatRollbacks((current) =>
      current.filter((snapshot) => snapshot.transferId !== transferId)
    );
  }, []);
  return (
    <DockablePanelProvider
      onGroupMoveRequest={handleGroupMove}
      canFloatPanel={canFloatPanel}
      onTabMoveRequest={(payload, target) => {
        void requestPanelTabMove(payload, target, workspacePanelPublication, windowName).catch(
          (error) =>
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'move-panel-tab',
              clusterId: payload.clusterId,
            })
        );
      }}
      tabDragIdentity={tabDragIdentity}
      onClusterTabTearOff={(payload, cursor) => {
        if (
          payload.sourceWindowName !== windowName ||
          !canMoveClusterToNewWindow(payload.clusterId, selectedClusterIds)
        ) {
          return;
        }
        void requestClusterTabTransfer(windowName, {
          transferId: newIdentity('cluster-transfer'),
          dropPosition: { x: Math.round(cursor.x), y: Math.round(cursor.y) },
          sourceWindowName: windowName,
          targetWindowName: '',
          clusterId: payload.clusterId,
          targetIndex: 0,
        }).catch((error) =>
          reportOperationalError(error, {
            source: 'WorkspacePanelCoordinator',
            action: 'tear-off-cluster',
            clusterId: payload.clusterId,
          })
        );
      }}
      onExternalTabDrop={handleExternalTabDrop}
      onTabTearOff={handleTabTearOff}
      canStartTabDrag={canStartTabDrag}
    >
      <WorkspacePanelSync>
        <WorkspacePanelLifecycle />
        <ClusterTabTransferCoordinator />
        <WorkspaceObjectRouteCoordinator
          windowName={windowName}
          pendingAutoFloatRollbacks={pendingAutoFloatRollbacks}
          onWindowOpened={handlePanelWindowOpened}
          onOwnedPanelWindowClosed={handlePanelWindowClosed}
          onAutoFloatRollbackSettled={handleAutoFloatRollbackSettled}
        >
          {children}
        </WorkspaceObjectRouteCoordinator>
      </WorkspacePanelSync>
    </DockablePanelProvider>
  );
}
function WorkspaceObjectRouteCoordinator({
  windowName,
  pendingAutoFloatRollbacks,
  onWindowOpened,
  onOwnedPanelWindowClosed,
  onAutoFloatRollbackSettled,
  children,
}: Readonly<{
  windowName: string;
  pendingAutoFloatRollbacks: panelwindow.GroupSnapshot[];
  onWindowOpened: (event: panelwindow.WindowOpenedEvent) => void;
  onOwnedPanelWindowClosed: (windowName: string, groupId?: string) => void;
  onAutoFloatRollbackSettled: (transferId: string) => void;
  children: React.ReactNode;
}>) {
  const { getOwnedPanel } = useObjectPanelState();
  const restoreWorkspacePanels = useRestoreWorkspacePanels();
  const {
    selectedClusterIds,
    selectedKubeconfigs,
    getClusterMeta,
    setActiveKubeconfig,
    selectedClusterId,
  } = useKubeconfig();
  const { tabGroups, focusPanel, detachPanelGroup, discardPanelLayouts } =
    useDockablePanelContext();
  const guards = usePanelLifecycleGuardRegistry();
  const removeLocalTabs = useRemoveWorkspacePanels();
  const pendingTargets = useRef(new Map<string, panelwindow.TabTransferRequest>());
  const sync = usePanelWorkspaceSync();
  const flushPublication = sync.flush;
  const activateCluster = useCallback(
    (clusterId: string) => {
      const selection = selectedKubeconfigs.find(
        (candidate) => getClusterMeta(candidate).id === clusterId
      );
      if (selection) {
        setActiveKubeconfig(selection);
      }
    },
    [selectedKubeconfigs, getClusterMeta, setActiveKubeconfig]
  );
  useEffect(() => {
    for (const snapshot of pendingAutoFloatRollbacks) {
      restoreWorkspacePanels(snapshot, 'right');
      onAutoFloatRollbackSettled(snapshot.transferId);
    }
  }, [pendingAutoFloatRollbacks, restoreWorkspacePanels, onAutoFloatRollbackSettled]);

  useEffect(
    () =>
      onPanelTabTransferRequested(({ request }) => {
        if (request.sourceWindowName !== windowName) {
          return;
        }
        const owned = getOwnedPanel(request.clusterId, request.tab.panelId);
        const sourceGroup = getGroupForPanel(tabGroups, request.tab.panelId);
        const blocker = guards.firstBlocker([request.tab.panelId]);
        if (
          guards.isFrozen() ||
          !isAuthoritativeTransferSource(request, owned, sourceGroup, windowName) ||
          blocker
        ) {
          blocker?.focus();
          void failPanelTabTransfer(windowName, request.transferId);
          return;
        }
        guards.freeze(request.transferId, [request.tab.panelId]);
        void flushPublication()
          .then(() => acceptPanelTabTransfer(windowName, request.transferId))
          .then(() => {
            if (request.targetKind === 'new-window') {
              return beginPanelWindowOpen(
                windowName,
                tornOffTabSnapshot(request, initialWindowBounds([request.tab.panelId]))
              );
            }
          })
          .catch((error) => {
            void failPanelTabTransfer(windowName, request.transferId);
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'accept-tab-transfer',
              clusterId: request.clusterId,
            });
          });
      }),
    [windowName, getOwnedPanel, tabGroups, guards, flushPublication]
  );

  useEffect(
    () =>
      onPanelTabTransferInsertRequested(({ request }) => {
        if (request.targetWindowName !== windowName) {
          return;
        }
        if (
          guards.isFrozen(request.transferId) ||
          !selectedClusterIds.includes(request.clusterId) ||
          (request.targetGroupId !== 'right' && request.targetGroupId !== 'bottom') ||
          getOwnedPanel(request.clusterId, request.tab.panelId)
        ) {
          void failPanelTabTransfer(windowName, request.transferId);
          return;
        }
        guards.freeze(request.transferId, [request.tab.panelId]);
        sync.stage(request.transferId, [
          {
            clusterId: request.clusterId,
            groupId: request.targetGroupId,
            tabs: [request.tab],
            activePanelId: request.tab.panelId,
          },
        ]);
        pendingTargets.current.set(request.transferId, request);
        activateCluster(request.clusterId);
        restoreWorkspacePanels(
          singleTabGroupSnapshot(request),
          request.targetGroupId,
          request.targetIndex
        );
      }),
    [
      windowName,
      selectedClusterIds,
      getOwnedPanel,
      activateCluster,
      restoreWorkspacePanels,
      guards,
      sync.stage,
    ]
  );

  useEffect(
    () =>
      onPanelTabTransferCommitted(({ request }) => {
        guards.releaseTransfer(request.transferId);
        sync.settle(request.transferId);
        pendingTargets.current.delete(request.transferId);
        if (request.sourceWindowName === windowName) {
          removeLocalTabs(request.clusterId, [request.tab.panelId]);
        }
      }),
    [windowName, removeLocalTabs, guards.releaseTransfer, sync.settle]
  );
  useEffect(
    () =>
      onPanelTabTransferFailed(({ request }) => {
        guards.releaseTransfer(request.transferId);
        sync.settle(request.transferId);
        if (!pendingTargets.current.delete(request.transferId)) {
          return;
        }
        removeLocalTabs(request.clusterId, [request.tab.panelId]);
      }),
    [removeLocalTabs, sync.settle, guards.releaseTransfer]
  );
  useEffect(
    () =>
      onPanelWindowOpened((event) => {
        if (event.snapshot.sourceWindowName !== windowName) {
          return;
        }
        const ids = (event.snapshot.tabs ?? []).map((tab) => tab.panelId);
        detachPanelGroup(event.snapshot.clusterId, ids);
        discardPanelLayouts(event.snapshot.clusterId, ids);
        onWindowOpened(event);
      }),
    [windowName, detachPanelGroup, discardPanelLayouts, onWindowOpened]
  );
  useEffect(
    () =>
      onPanelWindowClosed(({ windowName: closedWindowName, groupId }) =>
        onOwnedPanelWindowClosed(closedWindowName, groupId)
      ),
    [onOwnedPanelWindowClosed]
  );
  useIncomingDockBack({
    windowName,
    selectedClusterId,
    tabGroups,
    activateCluster,
    flushPublication,
  });

  useEffect(
    () =>
      onPanelWorkspaceFocusRequested(({ clusterId, panelId }) => {
        activateCluster(clusterId);
        focusPanel(panelId, clusterId);
      }),
    [activateCluster, focusPanel]
  );
  return children;
}

type DockBackStatus = 'mounted' | 'acknowledging' | 'rejected';

const reportDockBackError = (action: string, transfer: IncomingGroupTransfer) => (error: unknown) =>
  reportOperationalError(error, {
    source: 'WorkspacePanelCoordinator',
    action,
    clusterId: transfer.clusterId,
  });

// The directory stopped listing these moves: committed, cancelled, or source gone.
function releaseSettledDockBacks(
  statuses: Map<string, DockBackStatus>,
  incoming: readonly IncomingGroupTransfer[],
  release: (transferId: string) => void
) {
  const listed = new Set(incoming.map((transfer) => transfer.transferId));
  for (const transferId of statuses.keys()) {
    if (!listed.has(transferId)) {
      statuses.delete(transferId);
      release(transferId);
    }
  }
}

// Asks the directory to cancel a move this view cannot take; its next read then
// drops any provisional copy.
const cancelDockBack = (
  windowName: string,
  transfer: IncomingGroupTransfer,
  onError: (error: unknown) => void
) => {
  void failPanelWindowTransfer(windowName, transfer.sourceWindowName, transfer.transferId).catch(
    onError
  );
};

// Projects whole-group dock-backs the directory targets at this view: mount a
// provisional copy, acknowledge once it is visible, and release the guard when
// the directory stops listing the move (commit, cancel, or vanished source).
function useIncomingDockBack({
  windowName,
  selectedClusterId,
  tabGroups,
  activateCluster,
  flushPublication,
}: Readonly<{
  windowName: string;
  selectedClusterId: string;
  tabGroups: ReturnType<typeof useDockablePanelContext>['tabGroups'];
  activateCluster: (clusterId: string) => void;
  flushPublication: () => Promise<void>;
}>) {
  const incoming = useIncomingGroupTransfers();
  const guards = usePanelLifecycleGuardRegistry();
  const restoreWorkspacePanels = useRestoreWorkspacePanels();
  const statuses = useRef(new Map<string, DockBackStatus>());

  useEffect(() => {
    releaseSettledDockBacks(statuses.current, incoming, (transferId) =>
      guards.releaseTransfer(transferId)
    );
    for (const transfer of incoming) {
      if (statuses.current.has(transfer.transferId)) {
        continue;
      }
      // A view frozen by its own close or another move cannot take the group.
      if (guards.isFrozen(transfer.transferId)) {
        statuses.current.set(transfer.transferId, 'rejected');
        cancelDockBack(
          windowName,
          transfer,
          reportDockBackError('reject-dock-during-close', transfer)
        );
        continue;
      }
      statuses.current.set(transfer.transferId, 'mounted');
      guards.freeze(
        transfer.transferId,
        transfer.tabs.map((tab) => tab.panelId)
      );
      restoreWorkspacePanels(transfer, transfer.groupId);
    }
  }, [incoming, guards, windowName, restoreWorkspacePanels]);

  useEffect(() => {
    const mounted = new Set([...tabGroups.right.tabs, ...tabGroups.bottom.tabs]);
    for (const transfer of incoming) {
      if (statuses.current.get(transfer.transferId) !== 'mounted') {
        continue;
      }
      if (selectedClusterId !== transfer.clusterId) {
        activateCluster(transfer.clusterId);
        continue;
      }
      if (!transfer.tabs.every((tab) => mounted.has(tab.panelId))) {
        continue;
      }
      statuses.current.set(transfer.transferId, 'acknowledging');
      // Queued docked snapshots land before the commit, so none can omit the
      // committed tabs afterwards.
      void flushPublication()
        .then(() =>
          acknowledgePanelWindowDock(windowName, transfer.sourceWindowName, transfer.transferId)
        )
        .catch((error) => {
          // The registry may already have cancelled it; only the commit error matters.
          cancelDockBack(windowName, transfer, () => undefined);
          reportDockBackError('acknowledge-dock', transfer)(error);
        });
    }
  }, [incoming, tabGroups, selectedClusterId, activateCluster, flushPublication, windowName]);
}
